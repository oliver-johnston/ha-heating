from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import aiohttp

log = logging.getLogger(__name__)


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

    async def get_time_zone(self) -> str:
        url = f"{self.base_url}/api/config"
        try:
            async with self.session.get(url, headers=self._headers) as response:
                if response.status != 200:
                    body = await response.text()
                    raise HomeAssistantError(
                        f"Home Assistant config request failed ({response.status}): {body[:200]}"
                    )
                result = await response.json()
        except aiohttp.ClientError as exc:
            raise HomeAssistantError(f"Could not reach Home Assistant: {exc}") from exc
        time_zone = result.get("time_zone") if isinstance(result, dict) else None
        if not isinstance(time_zone, str) or not time_zone:
            raise HomeAssistantError("Home Assistant did not return its time zone")
        return time_zone

    async def call_service(
        self, domain: str, service: str, data: dict[str, Any]
    ) -> list[dict[str, Any]]:
        url = f"{self.base_url}/api/services/{domain}/{service}"
        try:
            async with self.session.post(url, headers=self._headers, json=data) as response:
                if response.status != 200:
                    body = await response.text()
                    raise HomeAssistantError(
                        f"Home Assistant service {domain}.{service} failed "
                        f"({response.status}): {body[:200]}"
                    )
                result = await response.json()
        except aiohttp.ClientError as exc:
            raise HomeAssistantError(f"Could not reach Home Assistant: {exc}") from exc
        if not isinstance(result, list):
            raise HomeAssistantError(
                f"Home Assistant service {domain}.{service} returned invalid data"
            )
        return result

    async def get_registry_snapshot(self) -> RegistrySnapshot:
        devices, entities, areas = await self._get_registries()
        states = await self.get_states()
        return RegistrySnapshot(devices=devices, entities=entities, areas=areas, states=states)

    async def listen_events(
        self,
        event_type: str,
        handler: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        """Maintain a reconnecting subscription to one Home Assistant event type."""
        retry_seconds = 1
        while True:
            try:
                await self._listen_events_once(event_type, handler)
                retry_seconds = 1
            except asyncio.CancelledError:
                raise
            except (HomeAssistantError, aiohttp.ClientError, TimeoutError) as exc:
                log.warning(
                    "Home Assistant event subscription failed; retrying in %s seconds: %s",
                    retry_seconds,
                    exc,
                )
                await asyncio.sleep(retry_seconds)
                retry_seconds = min(30, retry_seconds * 2)

    async def _listen_events_once(
        self,
        event_type: str,
        handler: Callable[[dict[str, Any]], Awaitable[None]],
    ) -> None:
        ws_url = (
            self.base_url.replace("http://", "ws://", 1).replace("https://", "wss://", 1)
            + "/websocket"
        )
        async with self.session.ws_connect(ws_url, heartbeat=30) as websocket:
            auth_required = await websocket.receive_json(timeout=10)
            if auth_required.get("type") != "auth_required":
                raise HomeAssistantError("Unexpected Home Assistant WebSocket greeting")
            await websocket.send_json({"type": "auth", "access_token": self.token})
            auth_result = await websocket.receive_json(timeout=10)
            if auth_result.get("type") != "auth_ok":
                raise HomeAssistantError("Home Assistant WebSocket authentication failed")
            await websocket.send_json(
                {"id": 1, "type": "subscribe_events", "event_type": event_type}
            )
            subscribed = await websocket.receive_json(timeout=15)
            if subscribed.get("id") != 1 or not subscribed.get("success"):
                error = subscribed.get("error", {}).get("message", "unknown error")
                raise HomeAssistantError(f"Event subscription failed: {error}")

            async for message in websocket:
                if message.type != aiohttp.WSMsgType.TEXT:
                    continue
                payload = message.json()
                event = payload.get("event") if payload.get("type") == "event" else None
                if not isinstance(event, dict) or event.get("event_type") != event_type:
                    continue
                data = event.get("data")
                data = {} if not isinstance(data, dict) else dict(data)
                context = event.get("context")
                if isinstance(context, dict):
                    data["_ha_context"] = context
                try:
                    await handler(data)
                except Exception:
                    log.exception("Could not handle Home Assistant event %s", event_type)

        raise HomeAssistantError("Home Assistant event subscription closed")

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
