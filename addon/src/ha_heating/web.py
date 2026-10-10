from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path

from aiohttp import web
from pydantic import ValidationError

from .config import (
    BoilerSettingsUpdate,
    ConfigStore,
    ControlSettingsUpdate,
    HeatingConfig,
    ScheduleUpdate,
    TemperaturePresets,
)
from .control import HeatingController
from .dashboard import build_dashboard
from .diagnostics import build_diagnostics
from .discovery import OnboardingRequest, discover, materialise_config
from .ha_client import HomeAssistantClient, HomeAssistantError

log = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).parent / "static"


class WebApplication:
    def __init__(
        self,
        ha: HomeAssistantClient,
        store: ConfigStore,
        static_dir: str | Path | None = None,
        controller: HeatingController | None = None,
    ):
        self.ha = ha
        self.store = store
        self.static_dir = Path(static_dir) if static_dir is not None else STATIC_DIR
        self.controller = controller

    async def health(self, request: web.Request) -> web.Response:
        del request
        return web.json_response({"status": "ok"})

    async def get_config(self, request: web.Request) -> web.Response:
        del request
        try:
            config = self.store.load()
        except (OSError, ValidationError) as exc:
            log.exception("Stored configuration is invalid")
            return web.json_response(
                {"configured": False, "error": f"Stored configuration is invalid: {exc}"},
                status=500,
            )
        return web.json_response(
            {
                "configured": config is not None,
                "config": config.model_dump(mode="json") if config else None,
            }
        )

    async def get_discovery(self, request: web.Request) -> web.Response:
        del request
        try:
            result = discover(await self.ha.get_registry_snapshot())
        except HomeAssistantError as exc:
            log.warning("Discovery failed: %s", exc)
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(result)

    async def get_dashboard(self, request: web.Request) -> web.Response:
        del request
        try:
            config = self.store.load()
            if config is None or not config.setup.schedules:
                return web.json_response(
                    {"error": "Complete setup before opening the dashboard"}, status=409
                )
            states = await self.ha.get_states()
            plan = self.controller.status.plan if self.controller else None
            controller_error = self.controller.status.last_error if self.controller else None
            result = build_dashboard(
                config,
                states,
                plan=plan,
                controller_error=controller_error,
            )
            result["issues"] = build_diagnostics(config, states, self.controller)["issues"]
        except (OSError, ValidationError):
            log.exception("Could not load dashboard configuration")
            return web.json_response({"error": "Stored configuration is invalid"}, status=500)
        except HomeAssistantError as exc:
            log.warning("Could not load dashboard states: %s", exc)
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(result)

    async def get_diagnostics(self, request: web.Request) -> web.Response:
        del request
        try:
            config = self.store.load()
            if config is None or not config.setup.schedules:
                return web.json_response(
                    {"error": "Complete setup before opening diagnostics"}, status=409
                )
            result = build_diagnostics(
                config,
                await self.ha.get_states(),
                self.controller,
            )
        except (OSError, ValidationError):
            log.exception("Could not load diagnostics configuration")
            return web.json_response({"error": "Stored configuration is invalid"}, status=500)
        except HomeAssistantError as exc:
            log.warning("Could not load diagnostic states: %s", exc)
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(result)

    async def save_onboarding(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
            selection = OnboardingRequest.model_validate(body)
            discovery_result = discover(await self.ha.get_registry_snapshot())
            config = materialise_config(selection, discovery_result)
            existing = self.store.load()
            if existing is not None:
                config.boiler_switch = existing.boiler_switch
                config.hot_water_switch = existing.hot_water_switch
                config.minimum_heat_requests = min(existing.minimum_heat_requests, len(config.trvs))
                config.control = existing.control
                config.presets = existing.presets
                config.setup = existing.setup
                room_groups = {trv.room_group for trv in config.trvs}
                existing_groups = {schedule.room_group for schedule in existing.schedules}
                config.schedules = [
                    schedule
                    for schedule in existing.schedules
                    if schedule.room_group in room_groups
                ]
                config.hot_water_schedule = existing.hot_water_schedule
                config.setup.schedules = existing.setup.schedules and existing_groups == room_groups
            config.setup.devices = True
            self.store.save(config)
        except ValidationError as exc:
            return web.json_response(
                {
                    "error": "Configuration is invalid",
                    "details": exc.errors(include_url=False, include_context=False),
                },
                status=400,
            )
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except HomeAssistantError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except OSError:
            log.exception("Could not save configuration")
            return web.json_response({"error": "Could not save configuration"}, status=500)
        return web.json_response({"status": "saved", "config": config.model_dump(mode="json")})

    async def save_control(self, request: web.Request) -> web.Response:
        try:
            config = self.store.load()
            if config is None:
                return web.json_response(
                    {"error": "Complete device setup before saving control settings"}, status=409
                )
            config.control = ControlSettingsUpdate.model_validate(await request.json())
            config.setup.control = True
            config.updated_at = datetime.now(UTC)
            self.store.save(config)
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
        return web.json_response({"status": "saved", "config": config.model_dump(mode="json")})

    async def save_boiler(self, request: web.Request) -> web.Response:
        try:
            existing = self.store.load()
            if existing is None:
                return web.json_response(
                    {"error": "Complete device setup before saving boiler settings"}, status=409
                )
            update = BoilerSettingsUpdate.model_validate(await request.json())
            if update.minimum_heat_requests > len(existing.trvs):
                raise ValueError(
                    "Minimum heat requests cannot exceed the number of configured TRVs"
                )
            discovery_result = discover(await self.ha.get_registry_snapshot())
            known_switches = {item["entity_id"] for item in discovery_result["switches"]}
            if update.boiler_switch not in known_switches | {None}:
                raise ValueError(f"Heating switch is not available: {update.boiler_switch}")
            if update.hot_water_switch not in known_switches | {None}:
                raise ValueError(f"Hot-water switch is not available: {update.hot_water_switch}")

            payload = existing.model_dump()
            payload.update(update.model_dump())
            payload["setup"]["boiler"] = True
            payload["updated_at"] = datetime.now(UTC)
            config = HeatingConfig.model_validate(payload)
            self.store.save(config)
        except ValidationError as exc:
            return web.json_response(
                {
                    "error": "Boiler settings are invalid",
                    "details": exc.errors(include_url=False, include_context=False),
                },
                status=400,
            )
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except HomeAssistantError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except OSError:
            log.exception("Could not save boiler settings")
            return web.json_response({"error": "Could not save boiler settings"}, status=500)
        return web.json_response({"status": "saved", "config": config.model_dump(mode="json")})

    async def save_schedules(self, request: web.Request) -> web.Response:
        try:
            config = self.store.load()
            if config is None:
                return web.json_response(
                    {"error": "Complete system setup before saving schedules"}, status=409
                )
            if not config.setup.presets:
                return web.json_response(
                    {"error": "Complete preset setup before saving schedules"}, status=409
                )
            update = ScheduleUpdate.model_validate(await request.json())
            room_groups = {trv.room_group for trv in config.trvs}
            scheduled_groups = [schedule.room_group for schedule in update.schedules]
            duplicate_groups = {
                group for group in scheduled_groups if scheduled_groups.count(group) > 1
            }
            if duplicate_groups:
                groups = ", ".join(sorted(duplicate_groups))
                raise ValueError(f"Room groups can only have one schedule: {groups}")
            missing_groups = room_groups - set(scheduled_groups)
            unknown_groups = set(scheduled_groups) - room_groups
            if missing_groups:
                groups = ", ".join(sorted(missing_groups))
                raise ValueError(f"Schedules are missing room groups: {groups}")
            if unknown_groups:
                groups = ", ".join(sorted(unknown_groups))
                raise ValueError(f"Schedules contain unknown room groups: {groups}")
            config.schedules = update.schedules
            config.hot_water_schedule = update.hot_water_schedule
            config.setup.schedules = True
            config.updated_at = datetime.now(UTC)
            self.store.save(config)
        except ValidationError as exc:
            return web.json_response(
                {
                    "error": "Schedules are invalid",
                    "details": exc.errors(include_url=False, include_context=False),
                },
                status=400,
            )
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)
        except OSError:
            log.exception("Could not save schedules")
            return web.json_response({"error": "Could not save schedules"}, status=500)
        return web.json_response({"status": "saved", "config": config.model_dump(mode="json")})

    async def save_presets(self, request: web.Request) -> web.Response:
        try:
            config = self.store.load()
            if config is None:
                return web.json_response(
                    {"error": "Complete system setup before saving presets"}, status=409
                )
            if not config.setup.boiler:
                return web.json_response(
                    {"error": "Complete or skip boiler setup before saving presets"}, status=409
                )
            if not config.setup.control:
                return web.json_response(
                    {"error": "Complete control setup before saving presets"}, status=409
                )
            config.presets = TemperaturePresets.model_validate(await request.json())
            config.setup.presets = True
            config.updated_at = datetime.now(UTC)
            self.store.save(config)
        except ValidationError as exc:
            return web.json_response(
                {
                    "error": "Presets are invalid",
                    "details": exc.errors(include_url=False, include_context=False),
                },
                status=400,
            )
        except OSError:
            log.exception("Could not save presets")
            return web.json_response({"error": "Could not save presets"}, status=500)
        return web.json_response({"status": "saved", "config": config.model_dump(mode="json")})

    async def index(self, request: web.Request) -> web.StreamResponse:
        del request
        index = self.static_dir / "index.html"
        if not index.exists():
            return web.Response(
                text="Frontend has not been built. Run npm ci && npm run build.", status=503
            )
        return web.FileResponse(index)

    def create(self) -> web.Application:
        app = web.Application(client_max_size=256 * 1024)
        app.router.add_get("/api/health", self.health)
        app.router.add_get("/api/config", self.get_config)
        app.router.add_get("/api/dashboard", self.get_dashboard)
        app.router.add_get("/api/diagnostics", self.get_diagnostics)
        app.router.add_get("/api/onboarding/discovery", self.get_discovery)
        app.router.add_put("/api/onboarding", self.save_onboarding)
        app.router.add_put("/api/boiler", self.save_boiler)
        app.router.add_put("/api/control", self.save_control)
        app.router.add_put("/api/presets", self.save_presets)
        app.router.add_put("/api/schedules", self.save_schedules)
        assets = self.static_dir / "assets"
        if assets.exists():
            app.router.add_static("/assets", assets, show_index=False)
        app.router.add_get("/{tail:.*}", self.index)
        return app
