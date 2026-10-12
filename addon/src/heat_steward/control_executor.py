from __future__ import annotations

import math
from collections.abc import Awaitable, Callable
from datetime import datetime
from time import monotonic
from typing import Any

from . import entity_state
from .config import HeatingConfig
from .control_plan import ControlPlan
from .ha_commands import HomeAssistantCommandRunner
from .metrics import CycleCommandResults

RecordEvent = Callable[[str, str], None]
SetError = Callable[[str], None]
LatchFault = Callable[[HeatingConfig, str], Awaitable[None]]


class ControlExecutor:
    """Reconcile a control plan with Home Assistant devices."""

    def __init__(
        self,
        commands: HomeAssistantCommandRunner,
        *,
        record_event: RecordEvent,
        set_error: SetError,
        latch_fault: LatchFault,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self._commands = commands
        self._record_event = record_event
        self._set_error = set_error
        self._latch_fault = latch_fault
        self._clock = clock
        self._boiler_changed_at: float | None = None
        self._boiler_on_since: float | None = None

    def observe_boiler_off(self) -> None:
        self._boiler_on_since = None

    def record_boiler_turned_off(self) -> None:
        self._boiler_changed_at = self._clock()
        self._boiler_on_since = None

    async def apply(
        self,
        config: HeatingConfig,
        states: list[dict[str, Any]],
        plan: ControlPlan,
        command_results: CycleCommandResults,
    ) -> bool:
        states_by_entity = {
            state["entity_id"]: state for state in states if isinstance(state.get("entity_id"), str)
        }
        unavailable_relays = [
            name
            for name, entity_id in (
                ("central-heating relay", config.boiler_switch),
                ("hot-water relay", config.hot_water_switch),
            )
            if entity_id and not entity_state.is_available(states_by_entity.get(entity_id))
        ]
        success = not unavailable_relays
        if unavailable_relays:
            message = f"Critical {' and '.join(unavailable_relays)} unavailable"
            self._set_error(message)
            self._record_event("error", message)
        now = self._clock()
        boiler_state = states_by_entity.get(config.boiler_switch) if config.boiler_switch else None
        boiler_state_age = entity_state.state_age_seconds(boiler_state, datetime.now().astimezone())
        if plan.boiler_is_on is not None and self._boiler_changed_at is None:
            self._boiler_changed_at = now - (boiler_state_age or 0)
        if plan.boiler_is_on is True:
            if self._boiler_on_since is None:
                self._boiler_on_since = now - (boiler_state_age or 0)
        elif plan.boiler_is_on is False:
            self._boiler_on_since = None

        if (
            self._boiler_on_since is not None
            and now - self._boiler_on_since >= config.control.maximum_boiler_on_seconds
        ):
            await self._latch_fault(
                config,
                (
                    "Central heating exceeded the configured maximum continuous runtime of "
                    f"{config.control.maximum_boiler_on_seconds} seconds"
                ),
            )
            return False

        if (
            config.boiler_switch
            and plan.boiler_is_on is True
            and not plan.boiler_should_be_on
            and self._boiler_may_change(config.control.minimum_boiler_on_seconds, now)
        ):
            changed = await self._commands.execute(
                "switch",
                "turn_off",
                {"entity_id": config.boiler_switch},
                "Turned central heating off",
                retries=config.control.command_retries,
                verify_entity=config.boiler_switch,
                expected_state="off",
            )
            command_results.boiler = changed
            success = success and changed
            if changed:
                self._boiler_changed_at = now
                self._boiler_on_since = None

        trvs = {trv.device_id: trv for trv in config.trvs}
        for decision in plan.rooms:
            trv = trvs[decision.device_id]
            climate = states_by_entity.get(trv.entities.climate, {})
            if not decision.available:
                continue
            if climate.get("state") != config.control.trv_mode:
                changed = await self._commands.execute(
                    "climate",
                    "set_hvac_mode",
                    {"entity_id": trv.entities.climate, "hvac_mode": config.control.trv_mode},
                    f"Set {trv.name} to heat mode",
                    retries=config.control.command_retries,
                    verify_entity=trv.entities.climate,
                    expected_state=config.control.trv_mode,
                )
                command_results.room_mode[decision.device_id] = changed
                success = success and changed
            if decision.trv_target_temperature is None or not math.isclose(
                decision.trv_target_temperature,
                decision.commanded_temperature,
                abs_tol=0.05,
            ):
                changed = await self._commands.execute(
                    "climate",
                    "set_temperature",
                    {
                        "entity_id": trv.entities.climate,
                        "temperature": decision.commanded_temperature,
                    },
                    f"Set {trv.name} to {decision.commanded_temperature:g}°C",
                    retries=config.control.command_retries,
                    verify_entity=trv.entities.climate,
                    expected_attribute="temperature",
                    expected_number=decision.commanded_temperature,
                )
                command_results.room_temperature[decision.device_id] = changed
                success = success and changed
            success = (
                await self._reconcile_entity(
                    config,
                    states_by_entity,
                    trv.entities.temperature_sensor_select,
                    "select",
                    "select_option",
                    "local_temperature",
                    "option",
                    f"Set {trv.name} temperature source to internal",
                )
                and success
            )
            success = (
                await self._reconcile_entity(
                    config,
                    states_by_entity,
                    trv.entities.smart_temperature_control,
                    "switch",
                    "turn_on" if config.control.smart_temperature_control else "turn_off",
                    "on" if config.control.smart_temperature_control else "off",
                    None,
                    f"Updated {trv.name} smart temperature control",
                )
                and success
            )
            success = (
                await self._reconcile_entity(
                    config,
                    states_by_entity,
                    trv.entities.open_window,
                    "switch",
                    "turn_on" if config.control.open_window_detection else "turn_off",
                    "on" if config.control.open_window_detection else "off",
                    None,
                    f"Updated {trv.name} open-window detection",
                )
                and success
            )
            success = (
                await self._reconcile_entity(
                    config,
                    states_by_entity,
                    trv.entities.child_lock,
                    "switch",
                    "turn_on" if config.control.child_lock else "turn_off",
                    "on" if config.control.child_lock else "off",
                    None,
                    f"Updated {trv.name} child lock",
                )
                and success
            )
            success = (
                await self._reconcile_number(
                    config,
                    states_by_entity,
                    trv.entities.frost_protection_temperature,
                    config.control.frost_protection_temperature,
                    f"Set {trv.name} frost protection",
                )
                and success
            )

        if (
            config.hot_water_switch
            and plan.hot_water_is_on is not None
            and plan.hot_water_should_be_on != plan.hot_water_is_on
        ):
            desired = bool(plan.hot_water_should_be_on)
            changed = await self._commands.execute(
                "switch",
                "turn_on" if desired else "turn_off",
                {"entity_id": config.hot_water_switch},
                f"Turned hot water {'on' if desired else 'off'}",
                retries=config.control.command_retries,
                verify_entity=config.hot_water_switch,
                expected_state="on" if desired else "off",
            )
            command_results.hot_water = changed
            success = success and changed

        if (
            config.boiler_switch
            and plan.boiler_is_on is False
            and plan.boiler_should_be_on
            and self._boiler_may_change(config.control.minimum_boiler_off_seconds, now)
        ):
            changed = await self._commands.execute(
                "switch",
                "turn_on",
                {"entity_id": config.boiler_switch},
                "Turned central heating on",
                retries=config.control.command_retries,
                verify_entity=config.boiler_switch,
                expected_state="on",
            )
            command_results.boiler = changed
            success = success and changed
            if changed:
                self._boiler_changed_at = now
                self._boiler_on_since = now
        return success

    async def turn_off_relays(self, config: HeatingConfig, reason: str) -> bool:
        success = True
        for entity_id, name in (
            (config.boiler_switch, "central heating"),
            (config.hot_water_switch, "hot water"),
        ):
            if entity_id:
                changed = await self._commands.execute(
                    "switch",
                    "turn_off",
                    {"entity_id": entity_id},
                    f"Turned {name} off {reason}",
                    retries=config.control.command_retries,
                    verify_entity=entity_id,
                    expected_state="off",
                )
                success = success and changed
        return success

    async def turn_off_boiler(self, config: HeatingConfig, description: str) -> bool:
        if not config.boiler_switch:
            return True
        stopped = await self._commands.execute(
            "switch",
            "turn_off",
            {"entity_id": config.boiler_switch},
            description,
            retries=config.control.command_retries,
            verify_entity=config.boiler_switch,
            expected_state="off",
        )
        if stopped:
            self.record_boiler_turned_off()
        return stopped

    def _boiler_may_change(self, minimum_seconds: int, now: float) -> bool:
        return self._boiler_changed_at is None or now - self._boiler_changed_at >= minimum_seconds

    async def _reconcile_entity(
        self,
        config: HeatingConfig,
        states: dict[str, dict[str, Any]],
        entity_id: str | None,
        domain: str,
        service: str,
        desired: str,
        value_key: str | None,
        description: str,
    ) -> bool:
        if not entity_id or states.get(entity_id, {}).get("state") == desired:
            return True
        data: dict[str, Any] = {"entity_id": entity_id}
        if value_key:
            data[value_key] = desired
        return await self._commands.execute(
            domain,
            service,
            data,
            description,
            retries=config.control.command_retries,
            verify_entity=entity_id,
            expected_state=desired,
        )

    async def _reconcile_number(
        self,
        config: HeatingConfig,
        states: dict[str, dict[str, Any]],
        entity_id: str | None,
        desired: float,
        description: str,
    ) -> bool:
        if not entity_id:
            return True
        current = entity_state.temperature(states.get(entity_id, {}).get("state"))
        if current is not None and math.isclose(current, desired, abs_tol=0.05):
            return True
        return await self._commands.execute(
            "number",
            "set_value",
            {"entity_id": entity_id, "value": desired},
            description,
            retries=config.control.command_retries,
            verify_entity=entity_id,
            expected_number=desired,
        )
