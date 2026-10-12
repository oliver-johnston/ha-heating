from __future__ import annotations

from aiohttp import web
from pydantic import ValidationError

from ..ha_client import HomeAssistantError
from ..overrides import (
    BoostCancel,
    BoostUpdate,
    HotWaterBoostUpdate,
    ModeUpdate,
    OverrideActionRequest,
)
from .common import WebContext


class OverrideRoutes:
    def __init__(self, context: WebContext):
        self.context = context

    def register(self, app: web.Application) -> None:
        app.router.add_put("/api/mode", self.set_mode)
        app.router.add_post("/api/boost", self.start_boost)
        app.router.add_post("/api/boost/cancel", self.cancel_boost)
        app.router.add_post("/api/hot-water/boost", self.start_hot_water_boost)
        app.router.add_post("/api/hot-water/boost/cancel", self.cancel_hot_water_boost)
        app.router.add_get("/api/overrides/actions", self.get_override_actions)
        app.router.add_post("/api/overrides/actions", self.create_override_action)

    def _controller_unavailable(self) -> web.Response:
        return web.json_response({"error": "The heating controller is not running"}, status=503)

    async def set_mode(self, request: web.Request) -> web.Response:
        controller = self.context.controller
        if controller is None:
            return self._controller_unavailable()
        try:
            update = ModeUpdate.model_validate(await request.json())
            state = await controller.set_mode(update.mode, actor=self.context.actor(request))
        except ValidationError as exc:
            return web.json_response(
                {
                    "error": "Heating mode is invalid",
                    "details": exc.errors(include_url=False, include_context=False),
                },
                status=400,
            )
        except (HomeAssistantError, OSError, ValueError) as exc:
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(
            {"status": "saved", "overrides": self.context.public_overrides(state)}
        )

    async def start_boost(self, request: web.Request) -> web.Response:
        controller = self.context.controller
        if controller is None:
            return self._controller_unavailable()
        try:
            update = BoostUpdate.model_validate(await request.json())
            state = await controller.start_boost(
                update.room_group,
                update.duration_minutes,
                actor=self.context.actor(request),
            )
        except ValidationError as exc:
            return web.json_response(
                {
                    "error": "Boost settings are invalid",
                    "details": exc.errors(include_url=False, include_context=False),
                },
                status=400,
            )
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except (HomeAssistantError, OSError) as exc:
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(
            {"status": "saved", "overrides": self.context.public_overrides(state)}
        )

    async def cancel_boost(self, request: web.Request) -> web.Response:
        controller = self.context.controller
        if controller is None:
            return self._controller_unavailable()
        try:
            update = BoostCancel.model_validate(await request.json())
            state = await controller.cancel_boost(
                update.room_group,
                actor=self.context.actor(request),
            )
        except ValidationError as exc:
            return web.json_response(
                {
                    "error": "Boost target is invalid",
                    "details": exc.errors(include_url=False, include_context=False),
                },
                status=400,
            )
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except (HomeAssistantError, OSError) as exc:
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(
            {"status": "saved", "overrides": self.context.public_overrides(state)}
        )

    async def start_hot_water_boost(self, request: web.Request) -> web.Response:
        controller = self.context.controller
        if controller is None:
            return self._controller_unavailable()
        try:
            update = HotWaterBoostUpdate.model_validate(await request.json())
            state = await controller.start_hot_water_boost(
                update.duration_minutes,
                actor=self.context.actor(request),
            )
        except ValidationError as exc:
            return web.json_response(
                {
                    "error": "Hot-water boost settings are invalid",
                    "details": exc.errors(include_url=False, include_context=False),
                },
                status=400,
            )
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except (HomeAssistantError, OSError) as exc:
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(
            {"status": "saved", "overrides": self.context.public_overrides(state)}
        )

    async def cancel_hot_water_boost(self, request: web.Request) -> web.Response:
        controller = self.context.controller
        if controller is None:
            return self._controller_unavailable()
        try:
            state = await controller.cancel_hot_water_boost(actor=self.context.actor(request))
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except (HomeAssistantError, OSError) as exc:
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(
            {"status": "saved", "overrides": self.context.public_overrides(state)}
        )

    async def get_override_actions(self, request: web.Request) -> web.Response:
        del request
        controller = self.context.controller
        if controller is None:
            return self._controller_unavailable()
        ledger = controller.override_store.load_ledger()
        if controller.override_store.last_error:
            return web.json_response(
                {"error": controller.override_store.last_error},
                status=503,
            )
        return web.json_response(
            {
                "schema_version": ledger.schema_version,
                "actions": [
                    action.model_dump(mode="json") for action in reversed(ledger.actions[-200:])
                ],
            }
        )

    async def create_override_action(self, request: web.Request) -> web.Response:
        controller = self.context.controller
        if controller is None:
            return self._controller_unavailable()
        try:
            update = OverrideActionRequest.model_validate(await request.json())
            state = await controller.apply_override(
                update,
                actor=self.context.actor(request),
                action_id=request.headers.get("Idempotency-Key"),
            )
        except ValidationError as exc:
            return web.json_response(
                {
                    "error": "Override action is invalid",
                    "details": exc.errors(include_url=False, include_context=False),
                },
                status=400,
            )
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except (HomeAssistantError, OSError) as exc:
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(
            {"status": "saved", "overrides": self.context.public_overrides(state)}
        )
