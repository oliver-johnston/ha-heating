from __future__ import annotations

import logging
from pathlib import Path

from aiohttp import web
from pydantic import ValidationError

from .config import ConfigStore
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
    ):
        self.ha = ha
        self.store = store
        self.static_dir = Path(static_dir) if static_dir is not None else STATIC_DIR

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

    async def save_onboarding(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
            selection = OnboardingRequest.model_validate(body)
            discovery_result = discover(await self.ha.get_registry_snapshot())
            config = materialise_config(selection, discovery_result)
            self.store.save(config)
        except ValidationError as exc:
            return web.json_response(
                {"error": "Configuration is invalid", "details": exc.errors(include_url=False)},
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
        app.router.add_get("/api/onboarding/discovery", self.get_discovery)
        app.router.add_put("/api/onboarding", self.save_onboarding)
        assets = self.static_dir / "assets"
        if assets.exists():
            app.router.add_static("/assets", assets, show_index=False)
        app.router.add_get("/{tail:.*}", self.index)
        return app
