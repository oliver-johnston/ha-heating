from __future__ import annotations

import logging
from datetime import UTC, datetime

from aiohttp import web
from pydantic import ValidationError

from ..config import NotificationSettings, NotificationSettingsUpdate
from ..notifications import NotificationDeliveryError
from .common import WebContext

log = logging.getLogger(__name__)


class NotificationRoutes:
    def __init__(self, context: WebContext):
        self.context = context

    def register(self, app: web.Application) -> None:
        app.router.add_put("/api/notifications", self.save_notifications)
        app.router.add_post("/api/notifications/test", self.test_notifications)

    async def save_notifications(self, request: web.Request) -> web.Response:
        try:
            config = self.context.store.load()
            if config is None:
                return web.json_response(
                    {"error": "Complete device setup before saving notifications"}, status=409
                )
            update = NotificationSettingsUpdate.model_validate(await request.json())
            webhook_url = config.notifications.discord_webhook_url
            if update.clear_webhook:
                webhook_url = None
            elif update.discord_webhook_url:
                webhook_url = update.discord_webhook_url
            config.notifications = NotificationSettings(
                enabled=update.enabled,
                discord_webhook_url=webhook_url,
                level=update.level,
                send_recovery=update.send_recovery,
                warning_delay_seconds=update.warning_delay_seconds,
            )
            config.updated_at = datetime.now(UTC)
            self.context.store.save(config)
            controller = self.context.controller
            if (update.clear_webhook or not update.enabled) and controller is not None:
                controller.notifier.reset()
        except ValidationError as exc:
            return web.json_response(
                {
                    "error": "Notification settings are invalid",
                    "details": exc.errors(
                        include_url=False, include_context=False, include_input=False
                    ),
                },
                status=400,
            )
        except OSError:
            log.exception("Could not save notification settings")
            return web.json_response({"error": "Could not save notification settings"}, status=500)
        return web.json_response({"status": "saved", "config": self.context.public_config(config)})

    async def test_notifications(self, request: web.Request) -> web.Response:
        del request
        controller = self.context.controller
        if controller is None:
            return web.json_response({"error": "The heating controller is not running"}, status=503)
        try:
            await controller.send_test_notification()
        except (NotificationDeliveryError, OSError, ValueError) as exc:
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response({"status": "sent"})
