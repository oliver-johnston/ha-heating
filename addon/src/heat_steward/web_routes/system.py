from __future__ import annotations

import logging
from datetime import datetime

from aiohttp import web
from pydantic import ValidationError

from ..dashboard import build_dashboard
from ..diagnostics import build_diagnostics
from ..ha_client import HomeAssistantError
from ..overrides import OverrideState
from .common import WebContext

log = logging.getLogger(__name__)


class SystemRoutes:
    def __init__(self, context: WebContext):
        self.context = context

    def register(self, app: web.Application) -> None:
        app.router.add_get("/api/health", self.health)
        app.router.add_get("/api/dashboard", self.get_dashboard)

    async def health(self, request: web.Request) -> web.Response:
        del request
        try:
            config = self.context.store.load()
        except (OSError, ValidationError) as exc:
            return web.json_response({"status": "error", "error": str(exc)}, status=503)
        controller = self.context.controller
        if controller is None or config is None or not config.setup.schedules:
            return web.json_response({"status": "ok", "controller": "not_configured"})
        status = controller.status
        reference = status.last_cycle_finished_at or status.started_at
        age = (datetime.now().astimezone() - reference).total_seconds()
        overdue_after = max(90, config.control.cycle_interval_seconds * 3)
        if age > overdue_after:
            return web.json_response(
                {
                    "status": "error",
                    "controller": "overdue",
                    "seconds_since_cycle": round(age),
                },
                status=503,
            )
        return web.json_response({"status": "ok", "controller": "healthy"})

    async def get_dashboard(self, request: web.Request) -> web.Response:
        del request
        try:
            config = self.context.store.load()
            if config is None or not config.setup.schedules:
                return web.json_response(
                    {"error": "Complete setup before opening the dashboard"}, status=409
                )
            states = await self.context.ha.get_states()
            controller = self.context.controller
            plan = controller.status.plan if controller else None
            controller_error = controller.status.last_error if controller else None
            overrides = controller.get_override_state() if controller else OverrideState()
            result = build_dashboard(
                config,
                states,
                plan=plan,
                controller_error=controller_error,
                overrides=overrides,
            )
            result["controller"]["fault_latched"] = config.safety.fault_latched
            result["controller"]["fault_reason"] = config.safety.fault_reason
            result["issues"] = build_diagnostics(config, states, controller)["issues"]
        except (OSError, ValidationError):
            log.exception("Could not load dashboard configuration")
            return web.json_response({"error": "Stored configuration is invalid"}, status=500)
        except HomeAssistantError as exc:
            log.warning("Could not load dashboard states: %s", exc)
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(result)
