from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Awaitable, Callable
from datetime import datetime
from time import monotonic
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .config import HeatingConfig
from .control_executor import ControlExecutor
from .control_plan import ControlPlan, RoomDecision, build_control_plan
from .controller_status import ControlEvent, ControllerStatus
from .event_store import EventStore
from .ha_client import HomeAssistantClient, HomeAssistantError
from .ha_commands import HomeAssistantCommandRunner
from .metrics import CycleCommandResults, MetricsStore
from .notifications import DiscordNotifier
from .overrides import (
    HeatingMode,
    OverrideActionRequest,
    OverrideActor,
    OverrideState,
    OverrideStore,
)
from .preflight import PreflightCheck, PreflightResult, build_preflight
from .safety import SafetyManager

__all__ = [
    "ControlPlan",
    "ControllerStatus",
    "HeatingController",
    "PreflightCheck",
    "PreflightResult",
    "RoomDecision",
    "build_control_plan",
    "build_preflight",
]

log = logging.getLogger(__name__)


class HeatingController:
    def __init__(
        self,
        ha: HomeAssistantClient,
        store: Any,
        *,
        event_store: EventStore | None = None,
        notifier: DiscordNotifier | None = None,
        override_store: OverrideStore | None = None,
        metrics_store: MetricsStore | None = None,
        app_version: str | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self.ha = ha
        self.store = store
        self.status = ControllerStatus()
        self.event_store = event_store or EventStore(store.events_path)
        self.notifier = notifier or DiscordNotifier(
            getattr(ha, "session", None), store.notification_state_path
        )
        self.override_store = override_store or OverrideStore(store.action_store_path)
        self.metrics_store = metrics_store or MetricsStore(store.metrics_path)
        self._app_version = app_version or os.environ.get("HEAT_STEWARD_VERSION", "development")
        self._sleep = sleep
        self._demands: dict[str, bool] = {}
        self._lock = asyncio.Lock()
        self._was_enabled: bool | None = None
        self._startup_ready = False
        self._override_store_error: str | None = None
        self._metrics_error: str | None = None
        self._reported_expired_actions: set[str] = set()
        self.command_runner = HomeAssistantCommandRunner(
            ha,
            on_success=self._record_success,
            on_failure=self._record_command_failure,
            sleep=sleep,
        )
        self.executor = ControlExecutor(
            self.command_runner,
            record_event=self._record_event,
            set_error=self._set_error,
            latch_fault=lambda config, reason: self.safety.latch_fault(config, reason),
        )
        self.safety = SafetyManager(
            ha,
            store,
            self.status,
            self.notifier,
            self.override_store,
            self.executor,
            record_event=self._record_event,
        )
        self._load_events()

    def get_override_state(self, at: datetime | None = None) -> OverrideState:
        now = at or datetime.now().astimezone()
        state = self.override_store.load(now)
        store_error = self.override_store.last_error
        if store_error and store_error != self._override_store_error:
            self._record_event(
                "warning",
                f"{store_error}; continuing with the last valid override state",
            )
        elif self._override_store_error and not store_error:
            self._record_event("info", "Override action storage recovered")
        self._override_store_error = store_error

        ledger = self.override_store.load_ledger()
        latest_by_key = {action.key: action for action in ledger.actions}
        for action in latest_by_key.values():
            if (
                action.operation == "set"
                and action.expires_at is not None
                and action.expires_at <= now
                and action.action_id not in self._reported_expired_actions
                and (now - action.expires_at).total_seconds() <= 120
            ):
                self._reported_expired_actions.add(action.action_id)
                if action.channel == "hot_water":
                    self._record_event("info", "Hot-water boost ended")
                elif action.channel == "temperature" and action.override_preset == "boost":
                    target = action.scope_id or "the whole house"
                    self._record_event("info", f"Boost ended for {target}")
        return state

    @staticmethod
    def _actor_label(actor: OverrideActor) -> str:
        return actor.name or actor.source

    def _validate_override_target(
        self,
        config: HeatingConfig,
        request: OverrideActionRequest,
    ) -> None:
        if request.channel == "temperature" and request.scope_type == "group":
            groups = {trv.room_group for trv in config.trvs}
            if request.scope_id not in groups:
                raise ValueError(f"Unknown room group: {request.scope_id}")
        if request.channel == "temperature" and request.scope_type == "room":
            device_ids = {trv.device_id for trv in config.trvs}
            if request.scope_id not in device_ids:
                raise ValueError(f"Unknown room: {request.scope_id}")
        if request.channel == "hot_water" and not config.hot_water_switch:
            raise ValueError("Hot water is not configured")

    async def apply_override(
        self,
        request: OverrideActionRequest,
        *,
        actor: OverrideActor,
        action_id: str | None = None,
    ) -> OverrideState:
        async with self._lock:
            config = self.store.load()
            if config is None:
                raise ValueError("Heating is not configured")
            self._validate_override_target(config, request)
            action = self.override_store.record(request, actor, action_id=action_id)
            target = request.scope_id or request.scope_type.replace("_", " ")
            self._record_event(
                "info",
                f"Recorded {request.channel} {request.operation} for {target} "
                f"from {self._actor_label(actor)} ({action.action_id})",
            )
        await self.run_once()
        return self.get_override_state()

    async def set_mode(
        self,
        mode: HeatingMode,
        *,
        source: str = "dashboard",
        actor: OverrideActor | None = None,
    ) -> OverrideState:
        if mode not in {"home", "away"}:
            raise ValueError("Heating mode must be home or away")
        actor = actor or OverrideActor(source=source)
        async with self._lock:
            if self.store.load() is None:
                raise ValueError("Heating is not configured")
            state = self.get_override_state()
            if state.mode != mode:
                self.override_store.record(
                    OverrideActionRequest(
                        channel="occupancy",
                        scope_type="house",
                        override_mode="mode",
                        mode=mode,
                    ),
                    actor,
                )
                self._record_event(
                    "info",
                    f"Heating mode changed to {mode.title()} from {self._actor_label(actor)}",
                )
        await self.run_once()
        return self.get_override_state()

    async def start_boost(
        self,
        room_group: str | None,
        duration_minutes: int,
        *,
        actor: OverrideActor | None = None,
    ) -> OverrideState:
        if duration_minutes not in {30, 60, 120, 240}:
            raise ValueError("Boost duration must be 30, 60, 120, or 240 minutes")
        actor = actor or OverrideActor(source="dashboard")
        async with self._lock:
            config = self.store.load()
            if config is None:
                raise ValueError("Heating is not configured")
            groups = {trv.room_group for trv in config.trvs}
            if room_group is not None and room_group not in groups:
                raise ValueError(f"Unknown room group: {room_group}")
            self.override_store.record(
                OverrideActionRequest(
                    channel="temperature",
                    scope_type="house" if room_group is None else "group",
                    scope_id=room_group,
                    override_mode="preset",
                    override_preset="boost",
                    duration_minutes=duration_minutes,
                ),
                actor,
            )
            target = room_group or "the whole house"
            self._record_event("info", f"Started a {duration_minutes}-minute boost for {target}")
        await self.run_once()
        return self.get_override_state()

    async def cancel_boost(
        self,
        room_group: str | None,
        *,
        actor: OverrideActor | None = None,
    ) -> OverrideState:
        actor = actor or OverrideActor(source="dashboard")
        async with self._lock:
            if self.store.load() is None:
                raise ValueError("Heating is not configured")
            state = self.get_override_state()
            scope_type = "house" if room_group is None else "group"
            matching = any(
                override.scope_type == scope_type
                and override.scope_id == room_group
                and override.override_mode == "preset"
                and override.preset == "boost"
                for override in state.temperature_overrides
            )
            if matching:
                self.override_store.record(
                    OverrideActionRequest(
                        channel="temperature",
                        scope_type=scope_type,
                        scope_id=room_group,
                        operation="clear",
                    ),
                    actor,
                )
                target = room_group or "the whole house"
                self._record_event("info", f"Cancelled boost for {target}")
        await self.run_once()
        return self.get_override_state()

    async def start_hot_water_boost(
        self,
        duration_minutes: int,
        *,
        actor: OverrideActor | None = None,
    ) -> OverrideState:
        if duration_minutes not in {30, 60, 120, 240}:
            raise ValueError("Hot-water boost duration must be 30, 60, 120, or 240 minutes")
        actor = actor or OverrideActor(source="dashboard")
        async with self._lock:
            config = self.store.load()
            if config is None:
                raise ValueError("Heating is not configured")
            if not config.hot_water_switch:
                raise ValueError("Hot water is not configured")
            self.override_store.record(
                OverrideActionRequest(
                    channel="hot_water",
                    scope_type="hot_water",
                    override_mode="on_off",
                    on_off=True,
                    duration_minutes=duration_minutes,
                ),
                actor,
            )
            self._record_event("info", f"Started a {duration_minutes}-minute hot-water boost")
        await self.run_once()
        return self.get_override_state()

    async def cancel_hot_water_boost(
        self,
        *,
        actor: OverrideActor | None = None,
    ) -> OverrideState:
        actor = actor or OverrideActor(source="dashboard")
        async with self._lock:
            if self.store.load() is None:
                raise ValueError("Heating is not configured")
            state = self.get_override_state()
            if state.hot_water_override is not None and state.hot_water_override.on:
                self.override_store.record(
                    OverrideActionRequest(
                        channel="hot_water",
                        scope_type="hot_water",
                        operation="clear",
                    ),
                    actor,
                )
                self._record_event("info", "Cancelled hot-water boost")
        await self.run_once()
        return self.get_override_state()

    async def handle_mode_event(self, event_data: dict[str, Any]) -> None:
        mode = event_data.get("mode")
        if mode not in {"home", "away"}:
            self._record_event(
                "warning",
                "Ignored heat_steward_set_mode event with an invalid mode",
            )
            return
        context = event_data.get("_ha_context")
        user_id = context.get("user_id") if isinstance(context, dict) else None
        await self.set_mode(
            mode,
            actor=OverrideActor(
                source="Home Assistant automation",
                user_id=user_id if isinstance(user_id, str) else None,
            ),
        )

    async def preflight(self, config: HeatingConfig | None = None) -> PreflightResult:
        async with self._lock:
            config = config or self.store.load()
            if config is None:
                raise ValueError("Complete setup before checking automatic control")
            return build_preflight(config, await self.ha.get_states())

    async def emergency_stop(self) -> bool:
        async with self._lock:
            config = self.store.load()
            if config is None:
                raise ValueError("Heating is not configured")
            config.control.enabled = False
            config.updated_at = datetime.now().astimezone()
            self.store.save(config)
            stopped = await self.executor.turn_off_relays(
                config,
                "because an emergency stop was requested",
            )
            self._was_enabled = False
            self.executor.observe_boiler_off()
            self._record_event("warning", "Emergency stop requested; automatic control disabled")
            return stopped

    async def disable_control(self) -> bool:
        async with self._lock:
            config = self.store.load()
            if config is None:
                raise ValueError("Heating is not configured")
            config.control.enabled = False
            config.updated_at = datetime.now().astimezone()
            self.store.save(config)
            stopped = await self.executor.turn_off_relays(
                config,
                "because automatic control was disabled",
            )
            self._was_enabled = False
            self.executor.observe_boiler_off()
            self._record_event("warning", "Automatic control disabled; relays commanded off")
            return stopped

    async def apply_configuration_change(
        self,
        config: HeatingConfig,
        section: str,
    ) -> HeatingConfig:
        """Store a validated change without interrupting automatic control.

        The controller lock lets any in-flight cycle finish before the atomic config
        replacement. The immediate cycle after releasing the lock reconciles every
        output against the new configuration.
        """
        async with self._lock:
            previous = self.store.load()
            if previous is None:
                raise ValueError("Heating is not configured")

            relay_selection_changed = (
                previous.boiler_switch != config.boiler_switch
                or previous.hot_water_switch != config.hot_water_switch
            )
            if previous.control.enabled and relay_selection_changed:
                stopped = await self.executor.turn_off_relays(
                    previous,
                    f"before applying changed {section}",
                )
                if not stopped:
                    raise HomeAssistantError(
                        "The existing relays could not be confirmed off; the change was not saved"
                    )

            self.store.save(config)
            self._record_event(
                "info",
                f"Updated {section}; automatic control remains enabled",
            )

        await self.run_once()
        return self.store.load() or config

    async def acknowledge_fault(self) -> None:
        async with self._lock:
            await self.safety.acknowledge_fault()
            self._startup_ready = False

    async def send_test_notification(self) -> None:
        async with self._lock:
            config = self.store.load()
            if config is None:
                raise ValueError("Heating is not configured")
            await self.notifier.send_test(config.notifications)

    async def run_once(self, at: datetime | None = None) -> ControlPlan | None:
        async with self._lock:
            self.status.last_cycle_started_at = datetime.now().astimezone()
            self.status.actions = []
            config: HeatingConfig | None = None
            states: list[dict[str, Any]] | None = None
            plan: ControlPlan | None = None
            overrides = OverrideState()
            commands = CycleCommandResults()
            try:
                config = self.store.load()
                if config is None:
                    self.status.plan = None
                    self.status.last_error = None
                    return None
                if not config.setup.schedules:
                    self.status.plan = None
                    self.status.last_error = None
                    if config.control.enabled:
                        await self.executor.turn_off_relays(
                            config,
                            "because schedule setup is incomplete",
                        )
                    return None
                self.safety.restore_fault(config)
                if at is None:
                    try:
                        zone = ZoneInfo(await self.ha.get_time_zone())
                    except (HomeAssistantError, ZoneInfoNotFoundError):
                        zone = datetime.now().astimezone().tzinfo
                    at = datetime.now(zone)
                states = await self.ha.get_states()
                overrides = self.get_override_state(at)
                plan = build_control_plan(config, states, at, self._demands, overrides)
                self._demands = {room.device_id: room.demand for room in plan.rooms}
                self.status.plan = plan
                self.status.last_error = None
                was_enabled = self._was_enabled
                self._was_enabled = config.control.enabled
                if not config.control.enabled:
                    self.status.waiting_for_readiness = False
                if was_enabled is not None and was_enabled != config.control.enabled:
                    self._startup_ready = False
                if was_enabled is None:
                    mode = "automatic control" if config.control.enabled else "monitoring-only mode"
                    self._record_event("info", f"Controller started in {mode}")
                elif was_enabled != config.control.enabled:
                    mode = "enabled" if config.control.enabled else "disabled"
                    self._record_event(
                        "warning" if config.control.enabled is False else "info",
                        f"Automatic control {mode}",
                    )

                if was_enabled is None and not config.control.enabled:
                    states_by_entity = {
                        state["entity_id"]: state
                        for state in states
                        if isinstance(state.get("entity_id"), str)
                    }
                    relay_reported_on = any(
                        entity_id and states_by_entity.get(entity_id, {}).get("state") == "on"
                        for entity_id in (config.boiler_switch, config.hot_water_switch)
                    )
                    if self.status.fault_latched or relay_reported_on:
                        await self.executor.turn_off_relays(
                            config,
                            "during safe startup reconciliation",
                        )

                if self.status.fault_latched:
                    await self.safety.enforce_safety_stop(config, states)
                    if not self.status.notification_sent:
                        await self.safety.notify_fault(
                            self.status.fault_reason or "Unknown safety stop", config
                        )

                if config.control.enabled and not self.status.fault_latched:
                    if not self._startup_ready:
                        preflight = build_preflight(config, states)
                        if not preflight.ok:
                            failures = [
                                check.detail
                                for check in preflight.checks
                                if not check.passed and check.severity == "error"
                            ]
                            message = "Waiting for Home Assistant to finish starting: " + " ".join(
                                failures
                            )
                            self.status.last_error = message
                            self.status.waiting_for_readiness = True
                            self.status.consecutive_failures = 0
                            self._record_event("warning", message)
                            log.warning(message)
                        else:
                            self._startup_ready = True
                            self.status.consecutive_failures = 0
                            self.status.last_error = None
                            self.status.waiting_for_readiness = False
                            self._record_event(
                                "info", "Startup checks passed; automatic control is running"
                            )
                    if not self.status.fault_latched and self._startup_ready:
                        applied = await self.executor.apply(config, states, plan, commands)
                        if applied:
                            self.status.consecutive_failures = 0
                            await self.safety.resolve_control_alert(config)
                        elif not self.status.fault_latched:
                            await self.safety.register_failure(
                                config,
                                self.status.last_error or "One or more commands were not confirmed",
                            )
                elif was_enabled:
                    await self.executor.turn_off_relays(
                        config,
                        "because automatic control was disabled",
                    )

                try:
                    await self.notifier.reconcile(
                        config.notifications,
                        self.safety.notification_issues(config, states, plan),
                        at=at,
                    )
                except Exception as exc:
                    log.warning(
                        "Unexpected notification reconciliation failure (%s)",
                        type(exc).__name__,
                    )

                if self.status.last_error is None and not self.status.fault_latched:
                    self.status.last_successful_cycle_at = datetime.now().astimezone()
                return plan
            except HomeAssistantError as exc:
                self._startup_ready = False
                self.status.consecutive_failures = 0
                self.status.last_error = f"Waiting for Home Assistant: {exc}"
                self.status.waiting_for_readiness = bool(
                    config and config.control.enabled and not self.status.fault_latched
                )
                self._record_event("warning", self.status.last_error)
                log.warning("Heating control is waiting for Home Assistant: %s", exc)
                return None
            except (OSError, ValueError) as exc:
                self.status.waiting_for_readiness = False
                self.status.last_error = str(exc)
                self._record_event("error", f"Control cycle failed: {exc}")
                if config and config.control.enabled:
                    await self.safety.register_failure(config, str(exc))
                log.warning("Heating control cycle failed: %s", exc)
                return None
            finally:
                self.status.last_cycle_finished_at = datetime.now().astimezone()
                if config is not None and plan is not None:
                    await self._record_metrics(config, plan, overrides, commands)

    async def _record_metrics(
        self,
        config: HeatingConfig,
        plan: ControlPlan,
        overrides: OverrideState,
        commands: CycleCommandResults,
    ) -> None:
        try:
            await asyncio.to_thread(
                self.metrics_store.record_cycle,
                config=config,
                plan=plan,
                heating_mode=overrides.mode,
                commands=commands,
                cycle_started_at=self.status.last_cycle_started_at,
                cycle_finished_at=self.status.last_cycle_finished_at or datetime.now().astimezone(),
                cycle_successful=(self.status.last_error is None and not self.status.fault_latched),
                control_error=self.status.last_error,
                fault_latched=self.status.fault_latched,
                fault_reason=self.status.fault_reason,
                app_version=self._app_version,
                actions=tuple(self.status.actions),
            )
        except Exception as exc:
            message = f"{type(exc).__name__}: {exc}"
            if message != self._metrics_error:
                self._record_event(
                    "warning",
                    f"Metrics storage failed; heating control is unaffected: {message}",
                )
            self._metrics_error = message
            log.warning("Could not record heating metrics; control is unaffected: %s", message)
        else:
            if self._metrics_error is not None:
                self._record_event("info", "Metrics storage recovered")
            self._metrics_error = None

    async def run_forever(self, *, maximum_cycles: int | None = None) -> None:
        unexpected_failures = 0
        cycles = 0
        self.status.loop_running = True
        try:
            while maximum_cycles is None or cycles < maximum_cycles:
                started = monotonic()
                try:
                    await self.run_once()
                    unexpected_failures = 0
                    cycles += 1
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    unexpected_failures += 1
                    self.status.loop_restarts += 1
                    self.status.last_error = f"Unexpected controller failure: {exc}"
                    self._record_event("error", self.status.last_error)
                    log.exception("Unexpected heating controller failure")
                    if unexpected_failures >= 3:
                        raise RuntimeError(
                            "Heating controller repeatedly crashed; exiting for Supervisor restart"
                        ) from exc
                    await self._sleep(min(30, 2 ** (unexpected_failures - 1)))
                    continue
                try:
                    config = self.store.load()
                    interval = config.control.cycle_interval_seconds if config else 30
                except (OSError, ValueError):
                    interval = 30
                if maximum_cycles is None or cycles < maximum_cycles:
                    await self._sleep(max(1, interval - (monotonic() - started)))
        finally:
            self.status.loop_running = False

    def _record_event(self, level: str, message: str) -> None:
        event = ControlEvent(
            occurred_at=datetime.now().astimezone(),
            level=level,
            message=message,
        )
        if (
            self.status.events
            and self.status.events[-1].level == level
            and self.status.events[-1].message == message
        ):
            self.status.events[-1] = event
            return
        else:
            self.status.events.append(event)
        del self.status.events[:-100]
        try:
            self.event_store.append(
                {
                    "occurred_at": event.occurred_at.isoformat(),
                    "level": event.level,
                    "message": event.message,
                }
            )
        except OSError as exc:
            log.warning("Could not persist heating event history: %s", exc)

    def _record_success(self, description: str) -> None:
        self.status.actions.append(description)
        self._record_event("info", description)

    def _record_command_failure(self, description: str, message: str) -> None:
        self.status.actions.append(f"Failed: {description}")
        self.status.last_error = message
        self._record_event("error", f"Failed: {description} — {message}")
        log.warning("Control action failed (%s): %s", description, message)

    def _set_error(self, message: str) -> None:
        self.status.last_error = message

    def _load_events(self) -> None:
        for item in self.event_store.load()[-100:]:
            try:
                occurred_at = datetime.fromisoformat(str(item["occurred_at"]))
                level = str(item["level"])
                message = str(item["message"])
            except (KeyError, TypeError, ValueError):
                continue
            if level in {"info", "warning", "error"}:
                self.status.events.append(
                    ControlEvent(occurred_at=occurred_at, level=level, message=message)
                )
