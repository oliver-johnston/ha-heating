from __future__ import annotations

import logging
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from aiohttp import web
from pydantic import ValidationError

from .config import (
    BoilerSettingsUpdate,
    ConfigStore,
    ControlSettingsUpdate,
    HeatingConfig,
    NotificationSettings,
    NotificationSettingsUpdate,
    ScheduleUpdate,
    TemperaturePresets,
)
from .control import HeatingController
from .dashboard import build_dashboard
from .diagnostics import build_diagnostics
from .discovery import OnboardingRequest, discover, materialise_config
from .ha_client import HomeAssistantClient, HomeAssistantError
from .notifications import NotificationDeliveryError

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

    @staticmethod
    def _public_config(config: HeatingConfig) -> dict:
        payload = config.model_dump(mode="json")
        notifications = payload["notifications"]
        webhook = notifications.pop("discord_webhook_url", None)
        notifications["discord_webhook_configured"] = bool(webhook)
        return payload

    async def _pause_for_change(
        self, config: HeatingConfig, section: str, changed: bool
    ) -> tuple[HeatingConfig, bool]:
        if not changed or not config.control.enabled:
            return config, False
        if self.controller is None:
            raise HomeAssistantError(
                "Automatic control is running but the controller is unavailable"
            )
        confirmed = await self.controller.pause_for_configuration_change(section)
        paused = self.store.load()
        if paused is None:
            raise OSError("Configuration disappeared while pausing automatic control")
        if not confirmed:
            raise HomeAssistantError(
                "Automatic control was disabled, but the relays could not be confirmed off"
            )
        return paused, True

    async def health(self, request: web.Request) -> web.Response:
        del request
        try:
            config = self.store.load()
        except (OSError, ValidationError) as exc:
            return web.json_response({"status": "error", "error": str(exc)}, status=503)
        if self.controller is None or config is None or not config.setup.schedules:
            return web.json_response({"status": "ok", "controller": "not_configured"})
        status = self.controller.status
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
                "config": self._public_config(config) if config else None,
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
            result["controller"]["fault_latched"] = config.safety.fault_latched
            result["controller"]["fault_reason"] = config.safety.fault_reason
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

    async def export_diagnostics(self, request: web.Request) -> web.Response:
        del request
        try:
            config = self.store.load()
            if config is None or not config.setup.schedules:
                return web.json_response(
                    {"error": "Complete setup before exporting diagnostics"}, status=409
                )
            states = await self.ha.get_states()
            diagnostics = build_diagnostics(config, states, self.controller)
            entity_ids = {
                entity_id
                for trv in config.trvs
                for entity_id in (
                    *trv.entities.model_dump().values(),
                    trv.external_temperature_sensor,
                    trv.external_temperature_last_seen,
                )
                if entity_id
            }
            entity_ids.update(
                entity_id
                for entity_id in (config.boiler_switch, config.hot_water_switch)
                if entity_id
            )
            configured_states = [state for state in states if state.get("entity_id") in entity_ids]
            generated_at = datetime.now().astimezone()
            response = web.json_response(
                {
                    "generated_at": generated_at.isoformat(),
                    "configuration": self._public_config(config),
                    "diagnostics": diagnostics,
                    "configured_entity_states": configured_states,
                }
            )
            response.headers["Content-Disposition"] = (
                f'attachment; filename="home-heating-diagnostics-{generated_at:%Y%m%d-%H%M%S}.json"'
            )
            return response
        except (OSError, ValidationError):
            log.exception("Could not export diagnostics")
            return web.json_response({"error": "Stored configuration is invalid"}, status=500)
        except HomeAssistantError as exc:
            return web.json_response({"error": str(exc)}, status=503)

    async def save_onboarding(self, request: web.Request) -> web.Response:
        control_paused = False
        try:
            body = await request.json()
            selection = OnboardingRequest.model_validate(body)
            discovery_result = discover(await self.ha.get_registry_snapshot())
            config = materialise_config(selection, discovery_result)
            existing = self.store.load()
            if existing is not None:
                existing, control_paused = await self._pause_for_change(
                    existing,
                    "radiator devices",
                    config.trvs != existing.trvs,
                )
                config.boiler_switch = existing.boiler_switch
                config.hot_water_switch = existing.hot_water_switch
                config.minimum_heat_requests = min(existing.minimum_heat_requests, len(config.trvs))
                config.control = existing.control
                config.safety = existing.safety
                config.notifications = existing.notifications
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
        return web.json_response(
            {
                "status": "saved",
                "control_paused": control_paused,
                "config": self._public_config(config),
            }
        )

    async def save_control(self, request: web.Request) -> web.Response:
        control_paused = False
        try:
            config = self.store.load()
            if config is None:
                return web.json_response(
                    {"error": "Complete device setup before saving control settings"}, status=409
                )
            previous_enabled = config.control.enabled
            update = ControlSettingsUpdate.model_validate(await request.json())
            settings_changed = update.model_dump(exclude={"enabled"}) != config.control.model_dump(
                exclude={"enabled"}
            )
            if previous_enabled and (settings_changed or not update.enabled):
                config, control_paused = await self._pause_for_change(
                    config,
                    "control settings",
                    True,
                )
                update.enabled = False
            proposed = config.model_copy(deep=True)
            proposed.control = update
            if update.enabled and not previous_enabled:
                if self.controller is None:
                    return web.json_response(
                        {"error": "The heating controller is not running"}, status=503
                    )
                preflight = await self.controller.preflight(proposed)
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
            config.control = update
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
        except HomeAssistantError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        try:
            if self.controller and config.control.enabled:
                await self.controller.run_once()
            config = self.store.load() or config
        except (HomeAssistantError, OSError, ValueError) as exc:
            return web.json_response({"error": str(exc)}, status=503)
        status = "faulted" if config.safety.fault_latched else "saved"
        return web.json_response(
            {
                "status": status,
                "control_paused": control_paused,
                "config": self._public_config(config),
            }
        )

    async def preflight_control(self, request: web.Request) -> web.Response:
        try:
            config = self.store.load()
            if config is None:
                return web.json_response(
                    {"error": "Complete device setup before checking automatic control"},
                    status=409,
                )
            update = ControlSettingsUpdate.model_validate(await request.json())
            proposed = config.model_copy(deep=True)
            proposed.control = update
            if self.controller is None:
                return web.json_response(
                    {"error": "The heating controller is not running"}, status=503
                )
            result = await self.controller.preflight(proposed)
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
        if self.controller is None:
            return web.json_response({"error": "The heating controller is not running"}, status=503)
        try:
            confirmed = await self.controller.emergency_stop()
            config = self.store.load()
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
                "config": self._public_config(config) if config else None,
            }
        )

    async def acknowledge_fault(self, request: web.Request) -> web.Response:
        del request
        if self.controller is None:
            return web.json_response({"error": "The heating controller is not running"}, status=503)
        try:
            await self.controller.acknowledge_fault()
            config = self.store.load()
        except (HomeAssistantError, OSError, ValueError) as exc:
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(
            {
                "status": "acknowledged",
                "config": self._public_config(config) if config else None,
            }
        )

    async def save_boiler(self, request: web.Request) -> web.Response:
        control_paused = False
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

            changed = (
                update.boiler_switch != existing.boiler_switch
                or update.hot_water_switch != existing.hot_water_switch
                or update.minimum_heat_requests != existing.minimum_heat_requests
            )
            existing, control_paused = await self._pause_for_change(
                existing,
                "boiler settings",
                changed,
            )

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
        return web.json_response(
            {
                "status": "saved",
                "control_paused": control_paused,
                "config": self._public_config(config),
            }
        )

    async def save_schedules(self, request: web.Request) -> web.Response:
        control_paused = False
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
            changed = (
                update.schedules != config.schedules
                or update.hot_water_schedule != config.hot_water_schedule
            )
            config, control_paused = await self._pause_for_change(
                config,
                "schedules",
                changed,
            )
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
        except HomeAssistantError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except OSError:
            log.exception("Could not save schedules")
            return web.json_response({"error": "Could not save schedules"}, status=500)
        return web.json_response(
            {
                "status": "saved",
                "control_paused": control_paused,
                "config": self._public_config(config),
            }
        )

    async def save_presets(self, request: web.Request) -> web.Response:
        control_paused = False
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
            presets = TemperaturePresets.model_validate(await request.json())
            config, control_paused = await self._pause_for_change(
                config,
                "temperature presets",
                presets != config.presets,
            )
            config.presets = presets
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
        except HomeAssistantError as exc:
            return web.json_response({"error": str(exc)}, status=503)
        except OSError:
            log.exception("Could not save presets")
            return web.json_response({"error": "Could not save presets"}, status=500)
        return web.json_response(
            {
                "status": "saved",
                "control_paused": control_paused,
                "config": self._public_config(config),
            }
        )

    async def save_notifications(self, request: web.Request) -> web.Response:
        try:
            config = self.store.load()
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
            self.store.save(config)
            if (update.clear_webhook or not update.enabled) and self.controller is not None:
                self.controller.notifier.reset()
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
        return web.json_response({"status": "saved", "config": self._public_config(config)})

    async def test_notifications(self, request: web.Request) -> web.Response:
        del request
        if self.controller is None:
            return web.json_response({"error": "The heating controller is not running"}, status=503)
        try:
            await self.controller.send_test_notification()
        except (NotificationDeliveryError, OSError, ValueError) as exc:
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response({"status": "sent"})

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
        app.router.add_get("/api/diagnostics/export", self.export_diagnostics)
        app.router.add_get("/api/onboarding/discovery", self.get_discovery)
        app.router.add_put("/api/onboarding", self.save_onboarding)
        app.router.add_put("/api/boiler", self.save_boiler)
        app.router.add_put("/api/control", self.save_control)
        app.router.add_post("/api/control/preflight", self.preflight_control)
        app.router.add_post("/api/control/emergency-stop", self.emergency_stop)
        app.router.add_post("/api/control/fault/acknowledge", self.acknowledge_fault)
        app.router.add_put("/api/presets", self.save_presets)
        app.router.add_put("/api/schedules", self.save_schedules)
        app.router.add_put("/api/notifications", self.save_notifications)
        app.router.add_post("/api/notifications/test", self.test_notifications)
        assets = self.static_dir / "assets"
        if assets.exists():
            app.router.add_static("/assets", assets, show_index=False)
        app.router.add_get("/{tail:.*}", self.index)
        return app
