from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any

from . import entity_state
from .config import HeatingConfig
from .control_executor import ControlExecutor
from .control_plan import ControlPlan
from .controller_status import ControllerStatus
from .ha_client import HomeAssistantClient, HomeAssistantError
from .notifications import DiscordNotifier, NotificationIssue
from .overrides import OverrideStore

log = logging.getLogger(__name__)

RecordEvent = Callable[[str, str], None]


class SafetyManager:
    """Own hard safety stops and recoverable control alerts."""

    def __init__(
        self,
        ha: HomeAssistantClient,
        store: Any,
        status: ControllerStatus,
        notifier: DiscordNotifier,
        override_store: OverrideStore,
        executor: ControlExecutor,
        *,
        record_event: RecordEvent,
    ) -> None:
        self._ha = ha
        self._store = store
        self._status = status
        self._notifier = notifier
        self._override_store = override_store
        self._executor = executor
        self._record_event = record_event
        self._control_alert_reconciled = False

    def restore_fault(self, config: HeatingConfig) -> None:
        if config.safety.fault_latched:
            self._status.fault_latched = True
            self._status.fault_reason = config.safety.fault_reason

    async def acknowledge_fault(self) -> None:
        config = self._store.load()
        if config is None:
            raise ValueError("Heating is not configured")
        config.safety.fault_latched = False
        config.safety.fault_reason = None
        config.safety.fault_at = None
        config.updated_at = datetime.now().astimezone()
        self._store.save(config)
        self._status.fault_latched = False
        self._status.fault_reason = None
        self._status.consecutive_failures = 0
        self._status.last_error = None
        self._record_event("info", "Safety stop acknowledged; automatic control will resume")
        try:
            await self._ha.call_service(
                "persistent_notification",
                "dismiss",
                {"notification_id": "heat_steward_safety_stop"},
            )
        except HomeAssistantError as exc:
            log.warning("Could not dismiss heating fault notification: %s", exc)
        self._status.notification_sent = False
        try:
            await self._notifier.resolve_fault(config.notifications, paused=True)
        except Exception as exc:
            log.warning(
                "Unexpected recovery notification failure (%s)",
                type(exc).__name__,
            )

    async def register_failure(self, config: HeatingConfig, reason: str) -> None:
        self._status.consecutive_failures += 1
        if self._status.consecutive_failures >= config.control.failures_before_alert:
            first_alert = self._status.control_alert_reason is None
            self._status.control_alert_reason = reason
            self._control_alert_reconciled = False
            if first_alert:
                self._record_event(
                    "error", f"Control problem detected; continuing to retry: {reason}"
                )
            if not self._status.notification_sent:
                await self.notify_fault(reason, config, paused=False)

    async def resolve_control_alert(self, config: HeatingConfig) -> None:
        active_in_this_process = self._status.control_alert_reason is not None
        if not active_in_this_process and self._control_alert_reconciled:
            return
        self._status.control_alert_reason = None
        self._status.notification_sent = False
        try:
            await self._ha.call_service(
                "persistent_notification",
                "dismiss",
                {"notification_id": "heat_steward_control_problem"},
            )
        except HomeAssistantError as exc:
            log.warning("Could not dismiss heating control notification: %s", exc)
        try:
            await self._notifier.resolve_fault(config.notifications, paused=False)
        except Exception as exc:
            log.warning("Unexpected recovery notification failure (%s)", type(exc).__name__)
        self._control_alert_reconciled = True
        if active_in_this_process:
            self._record_event(
                "info", "Heating control recovered; automatic control remained enabled"
            )

    async def latch_fault(self, config: HeatingConfig, reason: str) -> None:
        first_fault = not self._status.fault_latched
        self._status.fault_latched = True
        self._status.fault_reason = reason
        self._status.last_error = reason
        self._status.waiting_for_readiness = False
        config.safety.fault_latched = True
        config.safety.fault_reason = reason
        config.safety.fault_at = datetime.now().astimezone()
        config.updated_at = datetime.now().astimezone()
        self._store.save(config)
        if first_fault:
            self._record_event("error", f"Safety stop triggered: {reason}")
        await self._executor.turn_off_boiler(
            config,
            "Turned central heating off because a safety stop was triggered",
        )
        await self.notify_fault(reason, config, paused=True)

    async def enforce_safety_stop(
        self,
        config: HeatingConfig,
        states: list[dict[str, Any]],
    ) -> None:
        """Keep the heating relay off while a hard safety stop is latched."""
        if not config.boiler_switch:
            return
        state = next(
            (item for item in states if item.get("entity_id") == config.boiler_switch),
            None,
        )
        if entity_state.is_available(state) and state.get("state") == "off":
            self._executor.observe_boiler_off()
            return
        await self._executor.turn_off_boiler(
            config,
            "Kept central heating off while a safety stop is awaiting acknowledgement",
        )

    async def notify_fault(
        self,
        reason: str,
        config: HeatingConfig,
        *,
        paused: bool = True,
    ) -> None:
        title = "Heat Steward safety stop" if paused else "Heat Steward control problem"
        notification_id = "heat_steward_safety_stop" if paused else "heat_steward_control_problem"
        message = (
            "Automatic heating is paused until this safety stop is acknowledged. "
            if paused
            else "Automatic heating remains enabled and will keep retrying. "
        )
        try:
            await self._ha.call_service(
                "persistent_notification",
                "create",
                {
                    "notification_id": notification_id,
                    "title": title,
                    "message": message + reason,
                },
            )
            self._status.notification_sent = True
            self._record_event("info", f"Created a Home Assistant {title.lower()} notification")
        except HomeAssistantError as exc:
            self._status.notification_sent = False
            log.warning("Could not create heating fault notification: %s", exc)
        try:
            await self._notifier.notify_fault(config.notifications, reason, paused=paused)
        except Exception as exc:
            log.warning("Unexpected safety notification failure (%s)", type(exc).__name__)

    def notification_issues(
        self,
        config: HeatingConfig,
        states: list[dict[str, Any]],
        plan: ControlPlan,
    ) -> list[NotificationIssue]:
        issues: list[NotificationIssue] = []
        if self._override_store.last_error:
            issues.append(
                NotificationIssue(
                    key="storage:override-actions",
                    title="Override history could not be read",
                    detail=(
                        "The controller is using its last valid override state and is refusing "
                        "to overwrite the damaged action file."
                    ),
                    severity="warning",
                )
            )
        trvs = {trv.device_id: trv for trv in config.trvs}
        for room in plan.rooms:
            trv = trvs[room.device_id]
            name = trv.area_name or trv.name
            if not room.available:
                stale = room.status == "stale"
                issues.append(
                    NotificationIssue(
                        key=f"room:{room.device_id}:{'stale' if stale else 'unavailable'}",
                        title=(
                            f"{name} has not reported recently"
                            if stale
                            else f"{name} is unavailable"
                        ),
                        detail=(
                            "This room is being skipped and does not count towards heat demand. "
                            f"{room.warning or 'No usable room temperature is available.'}"
                        ),
                        severity="warning",
                    )
                )
            elif room.warning:
                issues.append(
                    NotificationIssue(
                        key=f"room:{room.device_id}:fallback",
                        title=f"{name} is using its fallback sensor",
                        detail=room.warning,
                        severity="warning",
                    )
                )

        states_by_entity = {
            state["entity_id"]: state for state in states if isinstance(state.get("entity_id"), str)
        }
        for key, name, entity_id in (
            ("central-heating", "Central-heating relay", config.boiler_switch),
            ("hot-water", "Hot-water relay", config.hot_water_switch),
        ):
            if entity_id and not entity_state.is_available(states_by_entity.get(entity_id)):
                issues.append(
                    NotificationIssue(
                        key=f"relay:{key}:unavailable",
                        title=f"{name} is unavailable",
                        detail=f"Home Assistant cannot read {entity_id}.",
                        severity="critical",
                    )
                )
        return issues
