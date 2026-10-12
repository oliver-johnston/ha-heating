from __future__ import annotations

import logging
from dataclasses import asdict
from datetime import UTC, datetime

from aiohttp import web
from pydantic import ValidationError

from ..config import ControlSettingsUpdate
from ..ha_client import HomeAssistantError
from .common import WebContext

log = logging.getLogger(__name__)


class ControlRoutes:
    def __init__(self, context: WebContext):
        self.context = context

    def register(self, app: web.Application) -> None:
        app.router.add_put("/api/control", self.save_control)
        app.router.add_post("/api/control/preflight", self.preflight_control)
        app.router.add_post("/api/control/emergency-stop", self.emergency_stop)
        app.router.add_post("/api/control/fault/acknowledge", self.acknowledge_fault)

    async def save_control(self, request: web.Request) -> web.Response:
        try:
            config = self.context.store.load()
            if config is None:
                return web.json_response(
                    {"error": "Complete device setup before saving control settings"}, status=409
                )
            previous_enabled = config.control.enabled
            update = ControlSettingsUpdate.model_validate(await request.json())
            settings_changed = update.model_dump(exclude={"enabled"}) != config.control.model_dump(
                exclude={"enabled"}
            )
            proposed = config.model_copy(deep=True)
            proposed.control = update
            controller = self.context.controller
            if update.enabled and (not previous_enabled or settings_changed):
                if controller is None:
                    return web.json_response(
                        {"error": "The heating controller is not running"}, status=503
                    )
                preflight = await controller.preflight(proposed)
                if not preflight.ok:
                    return web.json_response(
                        {
                            "error": (
                                "Automatic control cannot be enabled until pre-flight checks pass"
                            ),
                            "preflight": asdict(preflight),
                        },
                        status=409,
                    )
            if previous_enabled and not update.enabled:
                if controller is None:
                    return web.json_response(
                        {"error": "The heating controller is not running"}, status=503
                    )
                await controller.disable_control()
                config = self.context.store.load() or config
            config.control = update
            config.setup.control = True
            config.updated_at = datetime.now(UTC)
            config = await self.context.apply_change(
                config,
                "control settings",
                update.enabled and (not previous_enabled or settings_changed),
            )
        except ValidationError as exc:
            return web.json_response(
                {
                    "error": "Control settings are invalid",
                    "details": exc.errors(include_url=False, include_context=False),
                },
                status=400,
            )
        except OSError:
            log.exception("Could not save control settings")
            return web.json_response({"error": "Could not save control settings"}, status=500)
        except HomeAssistantError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        status = "faulted" if config.safety.fault_latched else "saved"
        return web.json_response(
            {
                "status": status,
                "config": self.context.public_config(config),
            }
        )

    async def preflight_control(self, request: web.Request) -> web.Response:
        try:
            config = self.context.store.load()
            if config is None:
                return web.json_response(
                    {"error": "Complete device setup before checking automatic control"},
                    status=409,
                )
            update = ControlSettingsUpdate.model_validate(await request.json())
            proposed = config.model_copy(deep=True)
            proposed.control = update
            controller = self.context.controller
            if controller is None:
                return web.json_response(
                    {"error": "The heating controller is not running"}, status=503
                )
            result = await controller.preflight(proposed)
        except ValidationError as exc:
            return web.json_response(
                {
                    "error": "Control settings are invalid",
                    "details": exc.errors(include_url=False, include_context=False),
                },
                status=400,
            )
        except (HomeAssistantError, OSError, ValueError) as exc:
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(asdict(result))

    async def emergency_stop(self, request: web.Request) -> web.Response:
        del request
        controller = self.context.controller
        if controller is None:
            return web.json_response({"error": "The heating controller is not running"}, status=503)
        try:
            confirmed = await controller.emergency_stop()
            config = self.context.store.load()
        except (HomeAssistantError, OSError, ValueError) as exc:
            return web.json_response(
                {
                    "error": str(exc),
                    "status": "automatic_control_disabled",
                },
                status=503,
            )
        return web.json_response(
            {
                "status": "stopped",
                "relays_confirmed_off": confirmed,
                "config": self.context.public_config(config) if config else None,
            }
        )

    async def acknowledge_fault(self, request: web.Request) -> web.Response:
        del request
        controller = self.context.controller
        if controller is None:
            return web.json_response({"error": "The heating controller is not running"}, status=503)
        try:
            await controller.acknowledge_fault()
            config = self.context.store.load()
        except (HomeAssistantError, OSError, ValueError) as exc:
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(
            {
                "status": "acknowledged",
                "config": self.context.public_config(config) if config else None,
            }
        )
