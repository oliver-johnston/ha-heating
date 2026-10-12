from __future__ import annotations

from pathlib import Path

from aiohttp import web

from .config import ConfigStore
from .control import HeatingController
from .ha_client import HomeAssistantClient
from .web_routes.common import WebContext
from .web_routes.control import ControlRoutes
from .web_routes.diagnostics import DiagnosticRoutes
from .web_routes.notifications import NotificationRoutes
from .web_routes.overrides import OverrideRoutes
from .web_routes.setup import SetupRoutes
from .web_routes.system import SystemRoutes

STATIC_DIR = Path(__file__).parent / "static"


class WebApplication:
    """Compose the HTTP route groups and serve the frontend."""

    def __init__(
        self,
        ha: HomeAssistantClient,
        store: ConfigStore,
        static_dir: str | Path | None = None,
        controller: HeatingController | None = None,
    ):
        self.static_dir = Path(static_dir) if static_dir is not None else STATIC_DIR
        self.context = WebContext(ha, store, controller)

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
        for routes in (
            SystemRoutes(self.context),
            DiagnosticRoutes(self.context),
            SetupRoutes(self.context),
            ControlRoutes(self.context),
            OverrideRoutes(self.context),
            NotificationRoutes(self.context),
        ):
            routes.register(app)

        assets = self.static_dir / "assets"
        if assets.exists():
            app.router.add_static("/assets", assets, show_index=False)
        app.router.add_get("/{tail:.*}", self.index)
        return app
