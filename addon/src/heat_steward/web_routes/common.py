from __future__ import annotations

from aiohttp import web

from ..config import ConfigStore, HeatingConfig
from ..control import HeatingController
from ..ha_client import HomeAssistantClient, HomeAssistantError
from ..overrides import OverrideActor, OverrideState


class WebContext:
    """Shared dependencies and response helpers for HTTP route groups."""

    def __init__(
        self,
        ha: HomeAssistantClient,
        store: ConfigStore,
        controller: HeatingController | None,
    ):
        self.ha = ha
        self.store = store
        self.controller = controller

    @staticmethod
    def public_config(config: HeatingConfig) -> dict:
        payload = config.model_dump(mode="json")
        notifications = payload["notifications"]
        webhook = notifications.pop("discord_webhook_url", None)
        notifications["discord_webhook_configured"] = bool(webhook)
        return payload

    @staticmethod
    def public_overrides(state: OverrideState) -> dict:
        return state.model_dump(mode="json")

    @staticmethod
    def actor(request: web.Request, *, source: str = "dashboard") -> OverrideActor:
        return OverrideActor(
            source=source,
            user_id=request.headers.get("X-Remote-User-Id"),
            name=(
                request.headers.get("X-Remote-User-Display-Name")
                or request.headers.get("X-Remote-User-Name")
            ),
        )

    async def apply_change(
        self, config: HeatingConfig, section: str, changed: bool
    ) -> HeatingConfig:
        if not changed or not config.control.enabled:
            self.store.save(config)
            return config
        if self.controller is None:
            raise HomeAssistantError(
                "Automatic control is running but the controller is unavailable"
            )
        return await self.controller.apply_configuration_change(config, section)
