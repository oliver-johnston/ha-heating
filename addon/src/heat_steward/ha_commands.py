from __future__ import annotations

import asyncio
import math
from collections.abc import Awaitable, Callable
from typing import Any

from . import entity_state
from .ha_client import HomeAssistantClient, HomeAssistantError

COMMAND_CONFIRMATION_CHECKS = 11
COMMAND_CONFIRMATION_POLL_SECONDS = 0.5

CommandSuccessCallback = Callable[[str], None]
CommandFailureCallback = Callable[[str, str], None]


class HomeAssistantCommandRunner:
    def __init__(
        self,
        ha: HomeAssistantClient,
        *,
        on_success: CommandSuccessCallback,
        on_failure: CommandFailureCallback,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._ha = ha
        self._on_success = on_success
        self._on_failure = on_failure
        self._sleep = sleep

    async def execute(
        self,
        domain: str,
        service: str,
        data: dict[str, Any],
        description: str,
        *,
        retries: int = 0,
        verify_entity: str | None = None,
        expected_state: str | None = None,
        expected_attribute: str | None = None,
        expected_number: float | None = None,
    ) -> bool:
        error: str | None = None
        for attempt in range(retries + 1):
            try:
                await self._ha.call_service(domain, service, data)
                if verify_entity is None:
                    self._on_success(description)
                    return True
                for check in range(COMMAND_CONFIRMATION_CHECKS):
                    verification_states = await self._ha.get_states()
                    if state_matches(
                        verification_states,
                        verify_entity,
                        expected_state,
                        expected_attribute,
                        expected_number,
                    ):
                        self._on_success(description)
                        return True
                    if check < COMMAND_CONFIRMATION_CHECKS - 1:
                        await self._sleep(COMMAND_CONFIRMATION_POLL_SECONDS)
                error = f"Home Assistant did not confirm the expected state for {verify_entity}"
            except HomeAssistantError as exc:
                error = str(exc)
            if attempt < retries:
                await self._sleep(COMMAND_CONFIRMATION_POLL_SECONDS)

        message = error or f"Home Assistant did not confirm {description.lower()}"
        self._on_failure(description, message)
        return False


def state_matches(
    states: list[dict[str, Any]],
    entity_id: str,
    expected_state: str | None,
    expected_attribute: str | None,
    expected_number: float | None,
) -> bool:
    state = next((item for item in states if item.get("entity_id") == entity_id), None)
    if not entity_state.is_available(state):
        return False
    if expected_attribute:
        actual: Any = state.get("attributes", {}).get(expected_attribute)
    else:
        actual = state.get("state")
    if expected_number is not None:
        number = entity_state.temperature(actual)
        return number is not None and math.isclose(number, expected_number, abs_tol=0.05)
    return expected_state is not None and actual == expected_state
