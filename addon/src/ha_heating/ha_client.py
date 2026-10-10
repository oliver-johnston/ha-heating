from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import aiohttp


class HomeAssistantError(RuntimeError):
    pass


@dataclass(frozen=True)
class RegistrySnapshot:
    devices: list[dict[str, Any]]
    entities: list[dict[str, Any]]
    areas: list[dict[str, Any]]
    states: list[dict[str, Any]]


class HomeAssistantClient:
    def __init__(self, base_url: str, token: str, session: aiohttp.ClientSession):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.session = session

    @property
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    async def get_states(self) -> list[dict[str, Any]]:
        url = f"{self.base_url}/api/states"
        try:
            async with self.session.get(url, headers=self._headers) as response:
                if response.status != 200:
                    body = await response.text()
                    raise HomeAssistantError(
                        f"Home Assistant states request failed ({response.status}): {body[:200]}"
                    )
                result = await response.json()
        except aiohttp.ClientError as exc:
            raise HomeAssistantError(f"Could not reach Home Assistant: {exc}") from exc
        if not isinstance(result, list):
            raise HomeAssistantError("Home Assistant returned an invalid states response")
        return result

    async def get_registry_snapshot(self) -> RegistrySnapshot:
        devices, entities, areas = await self._get_registries()
        states = await self.get_states()
        return RegistrySnapshot(devices=devices, entities=entities, areas=areas, states=states)

    async def _get_registries(
        self,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        ws_url = (
            self.base_url.replace("http://", "ws://", 1).replace("https://", "wss://", 1)
            + "/websocket"
        )
        try:
            async with self.session.ws_connect(ws_url, heartbeat=30) as websocket:
                auth_required = await websocket.receive_json(timeout=10)
                if auth_required.get("type") != "auth_required":
                    raise HomeAssistantError("Unexpected Home Assistant WebSocket greeting")
                await websocket.send_json({"type": "auth", "access_token": self.token})
                auth_result = await websocket.receive_json(timeout=10)
                if auth_result.get("type") != "auth_ok":
                    raise HomeAssistantError("Home Assistant WebSocket authentication failed")

                results: list[list[dict[str, Any]]] = []
                commands = (
                    "config/device_registry/list",
                    "config/entity_registry/list",
                    "config/area_registry/list",
                )
                for message_id, command in enumerate(commands, start=1):
                    await websocket.send_json({"id": message_id, "type": command})
                    message = await websocket.receive_json(timeout=15)
                    if message.get("id") != message_id or not message.get("success"):
                        error = message.get("error", {}).get("message", "unknown error")
                        raise HomeAssistantError(f"Registry request {command} failed: {error}")
                    result = message.get("result")
                    if not isinstance(result, list):
                        raise HomeAssistantError(
                            f"Registry request {command} returned invalid data"
                        )
                    results.append(result)
                return results[0], results[1], results[2]
        except TimeoutError as exc:
            raise HomeAssistantError("Home Assistant registry request timed out") from exc
        except aiohttp.ClientError as exc:
            raise HomeAssistantError(f"Could not reach Home Assistant WebSocket: {exc}") from exc
        except asyncio.CancelledError:
            raise
