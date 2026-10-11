from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from pathlib import Path

from aiohttp import web

from dev.harness import ROOT, MockHomeAssistant


async def serve() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    host = os.environ.get("SIMULATOR_HOST", "0.0.0.0")
    port = int(os.environ.get("SIMULATOR_PORT", "18123"))
    heating_port = int(os.environ.get("SIMULATOR_HEATING_PORT", "8099"))
    config_path = Path(
        os.environ.get("SIMULATOR_CONFIG_PATH", ROOT / ".dev-data" / "smoke-config.json")
    )
    static_dir = Path(
        os.environ.get("SIMULATOR_STATIC_DIR", ROOT / "addon" / "frontend" / "simulator-dist")
    )

    mock = MockHomeAssistant(os.environ.get("SIMULATOR_SCENARIO", "healthy"))
    runner = web.AppRunner(
        mock.create_app(
            heating_port=heating_port,
            config_path=config_path,
            static_dir=static_dir,
        )
    )
    await runner.setup()
    await web.TCPSite(runner, host, port).start()
    logging.getLogger(__name__).info("Simulator listening on http://%s:%s", host, port)
    try:
        await asyncio.Event().wait()
    finally:
        await runner.cleanup()


def main() -> None:
    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(serve())


if __name__ == "__main__":
    main()
