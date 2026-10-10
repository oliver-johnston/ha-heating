from __future__ import annotations

import asyncio
import logging
import os

import aiohttp
from aiohttp import web

from .config import ConfigStore
from .ha_client import HomeAssistantClient
from .web import WebApplication


async def run() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    token = os.environ.get("SUPERVISOR_TOKEN")
    if not token:
        raise RuntimeError("SUPERVISOR_TOKEN is required")

    timeout = aiohttp.ClientTimeout(total=30)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        ha = HomeAssistantClient(
            base_url=os.environ.get("HA_BASE_URL", "http://supervisor/core"),
            token=token,
            session=session,
        )
        store = ConfigStore(os.environ.get("CONFIG_PATH", "/data/heating-config.json"))
        runner = web.AppRunner(WebApplication(ha=ha, store=store).create())
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", int(os.environ.get("PORT", "8099")))
        await site.start()
        logging.getLogger(__name__).info("Home Heating onboarding UI started")
        try:
            await asyncio.Event().wait()
        finally:
            await runner.cleanup()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
