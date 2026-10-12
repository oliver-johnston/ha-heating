from __future__ import annotations

import asyncio
import logging
import sqlite3
from datetime import UTC, datetime, timedelta

from aiohttp import web
from pydantic import ValidationError

from ..diagnostics import build_diagnostics
from ..ha_client import HomeAssistantError
from ..metrics import MetricsStore
from .common import WebContext

log = logging.getLogger(__name__)
HISTORY_BUCKET_SECONDS = {6: 30, 24: 120, 168: 900}


class DiagnosticRoutes:
    def __init__(self, context: WebContext):
        self.context = context

    def register(self, app: web.Application) -> None:
        app.router.add_get("/api/diagnostics", self.get_diagnostics)
        app.router.add_get("/api/diagnostics/history", self.get_diagnostic_history)
        app.router.add_get("/api/diagnostics/export", self.export_diagnostics)

    async def get_diagnostics(self, request: web.Request) -> web.Response:
        del request
        try:
            config = self.context.store.load()
            if config is None or not config.setup.schedules:
                return web.json_response(
                    {"error": "Complete setup before opening diagnostics"}, status=409
                )
            result = build_diagnostics(
                config,
                await self.context.ha.get_states(),
                self.context.controller,
            )
        except (OSError, ValidationError):
            log.exception("Could not load diagnostics configuration")
            return web.json_response({"error": "Stored configuration is invalid"}, status=500)
        except HomeAssistantError as exc:
            log.warning("Could not load diagnostic states: %s", exc)
            return web.json_response({"error": str(exc)}, status=503)
        return web.json_response(result)

    async def get_diagnostic_history(self, request: web.Request) -> web.Response:
        try:
            config = self.context.store.load()
            if config is None or not config.setup.schedules:
                return web.json_response(
                    {"error": "Complete setup before opening diagnostics"}, status=409
                )
            try:
                hours = int(request.query.get("hours", "24"))
            except ValueError:
                return web.json_response({"error": "History range is invalid"}, status=400)
            if hours not in HISTORY_BUCKET_SECONDS:
                return web.json_response(
                    {"error": "History range must be 6, 24, or 168 hours"}, status=400
                )

            requested_ids = list(dict.fromkeys(request.query.getall("device_id", [])))
            configured = {trv.device_id: trv for trv in config.trvs}
            if not requested_ids:
                return web.json_response(
                    {"error": "Select at least one radiator valve"}, status=400
                )
            unknown = [device_id for device_id in requested_ids if device_id not in configured]
            if unknown:
                return web.json_response(
                    {"error": "One or more selected radiator valves are not configured"},
                    status=400,
                )
            if len(requested_ids) > 16:
                return web.json_response(
                    {"error": "Select no more than 16 radiator valves"}, status=400
                )

            end_at = datetime.now(UTC)
            start_at = end_at - timedelta(hours=hours)
            bucket_seconds = HISTORY_BUCKET_SECONDS[hours]
            controller = self.context.controller
            metrics = (
                controller.metrics_store
                if controller is not None
                else MetricsStore(self.context.store.metrics_path)
            )
            samples = await asyncio.to_thread(
                metrics.room_history,
                requested_ids,
                start_at=start_at,
                end_at=end_at,
                bucket_seconds=bucket_seconds,
            )
            rooms = [
                {
                    "device_id": device_id,
                    "name": configured[device_id].area_name or configured[device_id].name,
                    "room_group": configured[device_id].room_group,
                    "climate_entity": configured[device_id].entities.climate,
                }
                for device_id in requested_ids
            ]
            return web.json_response(
                {
                    "generated_at": end_at.isoformat(),
                    "start_at": start_at.isoformat(),
                    "end_at": end_at.isoformat(),
                    "hours": hours,
                    "bucket_seconds": bucket_seconds,
                    "rooms": rooms,
                    "samples": samples,
                }
            )
        except (OSError, ValidationError):
            log.exception("Could not load diagnostics history configuration")
            return web.json_response({"error": "Stored configuration is invalid"}, status=500)
        except (sqlite3.Error, ValueError) as exc:
            log.warning("Could not load diagnostics history: %s", exc)
            return web.json_response({"error": "Historical metrics are unavailable"}, status=503)

    async def export_diagnostics(self, request: web.Request) -> web.Response:
        del request
        try:
            config = self.context.store.load()
            if config is None or not config.setup.schedules:
                return web.json_response(
                    {"error": "Complete setup before exporting diagnostics"}, status=409
                )
            states = await self.context.ha.get_states()
            diagnostics = build_diagnostics(config, states, self.context.controller)
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
                    "configuration": self.context.public_config(config),
                    "diagnostics": diagnostics,
                    "configured_entity_states": configured_states,
                }
            )
            response.headers["Content-Disposition"] = (
                f'attachment; filename="heat-steward-diagnostics-{generated_at:%Y%m%d-%H%M%S}.json"'
            )
            return response
        except (OSError, ValidationError):
            log.exception("Could not export diagnostics")
            return web.json_response({"error": "Stored configuration is invalid"}, status=500)
        except HomeAssistantError as exc:
            return web.json_response({"error": str(exc)}, status=503)
