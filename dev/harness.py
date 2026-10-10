from __future__ import annotations

import asyncio
import copy
import html
import json
import logging
import os
from contextlib import suppress
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import WSMsgType, web
from ha_heating.config import ConfigStore
from ha_heating.ha_client import HomeAssistantClient, RegistrySnapshot
from ha_heating.web import WebApplication

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "dev-token"
SCENARIOS = {
    "healthy": "Eight healthy valves, matching room thermometers, and both boiler relays.",
    "missing_entities": "Dining TRV is missing its external-temperature input and smart control.",
    "offline_sensor": "The Kitchen external thermometer is unavailable.",
    "no_trvs": "No compatible radiator valves are present.",
}
ROOMS = (
    ("kitchen", "Kitchen", 20.4),
    ("dining", "Dining", 20.1),
    ("living", "Living", 20.8),
    ("guest", "Guest", 18.4),
    ("hannah", "Hannah", 21.7),
    ("bedroom", "Bedroom", 19.9),
    ("emily", "Emily", 20.2),
    ("office", "Office", 19.5),
)


def _entity(
    entity_id: str,
    device_id: str,
    original_name: str,
    *,
    area_id: str | None = None,
) -> dict[str, Any]:
    return {
        "entity_id": entity_id,
        "device_id": device_id,
        "original_name": original_name,
        "name": None,
        "area_id": area_id,
        "disabled_by": None,
    }


def _state(entity_id: str, state: str, **attributes: Any) -> dict[str, Any]:
    return {"entity_id": entity_id, "state": state, "attributes": attributes}


def build_snapshot(scenario: str = "healthy") -> RegistrySnapshot:
    """Build a deterministic, realistic Home Assistant registry snapshot."""
    if scenario not in SCENARIOS:
        raise ValueError(f"Unknown harness scenario: {scenario}")

    areas = [{"area_id": slug, "name": name} for slug, name, _ in ROOMS]
    areas.append({"area_id": "utility", "name": "Utility Room"})
    devices: list[dict[str, Any]] = []
    entities: list[dict[str, Any]] = []
    states: list[dict[str, Any]] = []

    auxiliary_entities = (
        ("number", "external_temperature_input", "External temperature input", "20.0"),
        ("number", "frost_protection_temperature", "Frost protection temperature", "5.0"),
        ("number", "local_temperature_calibration", "Local temperature calibration", "0.0"),
        ("number", "temperature_accuracy", "Temperature accuracy", "0.2"),
        ("number", "temporary_mode_duration", "Temporary mode duration", "60"),
        ("number", "timer_mode_target_temp", "Timer mode target temp", "21.0"),
        ("sensor", "local_temperature", "Local temperature", "20.0"),
        ("sensor", "battery", "Battery", "87"),
        ("sensor", "last_seen", "Last seen", "2026-10-10T10:00:00+00:00"),
        ("switch", "child_lock", "Child lock", "off"),
        ("switch", "smart_temperature_control", "Smart temperature control", "on"),
        ("switch", "open_window", "Open window", "off"),
        ("select", "temperature_sensor_select", "Temperature sensor select", "external"),
        ("select", "temporary_mode_select", "Temporary mode select", "off"),
        ("number", "valve_opening_degree", "Valve opening degree", "100"),
        ("number", "valve_closing_degree", "Valve closing degree", "0"),
        ("sensor", "closing_steps", "Closing steps", "476"),
        ("sensor", "idle_steps", "Idle steps", "210"),
        ("sensor", "valve_opening_limit_voltage", "Valve opening limit voltage", "1.8"),
        ("sensor", "valve_closing_limit_voltage", "Valve closing limit voltage", "1.7"),
        ("sensor", "valve_motor_running_voltage", "Valve motor running voltage", "1.5"),
    )

    for index, (slug, name, temperature) in enumerate(ROOMS, start=1):
        trv_id = f"mock-{slug}-trv"
        thermometer_id = f"mock-{slug}-thermometer"
        devices.extend(
            [
                {
                    "id": trv_id,
                    "name": f"{name} TRV",
                    "name_by_user": None,
                    "manufacturer": "SONOFF",
                    "model": "Zigbee thermostatic radiator valve",
                    "sw_version": "1.4.4",
                    "area_id": slug,
                },
                {
                    "id": thermometer_id,
                    "name": f"{name} thermometer",
                    "name_by_user": None,
                    "manufacturer": "SONOFF",
                    "model": "Zigbee temperature and humidity sensor",
                    "sw_version": "1.0.0",
                    "area_id": slug,
                },
            ]
        )
        climate_id = f"climate.{slug}_trv"
        entities.append(_entity(climate_id, trv_id, "Thermostat"))
        states.append(
            _state(
                climate_id,
                "heat",
                friendly_name=f"{name} TRV",
                current_temperature=temperature - 0.4,
                temperature=21.0,
                hvac_action="heating" if temperature < 20 else "idle",
            )
        )
        for domain, suffix, original_name, value in auxiliary_entities:
            entity_id = f"{domain}.{slug}_trv_{suffix}"
            entities.append(_entity(entity_id, trv_id, original_name))
            attributes: dict[str, Any] = {"friendly_name": f"{name} TRV {original_name}"}
            if suffix in {"local_temperature", "external_temperature_input"}:
                attributes.update(device_class="temperature", unit_of_measurement="°C")
            elif suffix == "battery":
                attributes.update(device_class="battery", unit_of_measurement="%")
            states.append(
                _state(
                    entity_id,
                    str(temperature) if suffix == "local_temperature" else value,
                    **attributes,
                )
            )

        linkquality_id = f"sensor.0x00124b0024{index:06x}_linkquality"
        entities.append(_entity(linkquality_id, trv_id, "Linkquality"))
        states.append(_state(linkquality_id, str(80 + index), unit_of_measurement="lqi"))
        update_id = f"update.{slug}_trv"
        entities.append(_entity(update_id, trv_id, "Firmware"))
        states.append(_state(update_id, "off", installed_version="1.4.4", latest_version="1.4.4"))

        sensor_id = f"sensor.{slug}_thermometer_temperature"
        entities.append(_entity(sensor_id, thermometer_id, "Temperature"))
        states.append(
            _state(
                sensor_id,
                str(temperature),
                friendly_name=f"{name} thermometer Temperature",
                device_class="temperature",
                unit_of_measurement="°C",
            )
        )

    devices.append(
        {
            "id": "mock-boiler",
            "name": "Boiler Switch",
            "name_by_user": None,
            "manufacturer": "SONOFF",
            "model": "Two-channel Wi-Fi switch",
            "sw_version": "3.7.6",
            "area_id": "utility",
        }
    )
    for entity_id, original_name in (
        ("switch.boiler_switch_central_heating_switch", "Central heating switch"),
        ("switch.boiler_switch_hot_water_switch", "Hot water switch"),
    ):
        entities.append(_entity(entity_id, "mock-boiler", original_name))
        states.append(_state(entity_id, "off", friendly_name=original_name.title()))

    snapshot = RegistrySnapshot(devices=devices, entities=entities, areas=areas, states=states)
    return _apply_scenario(snapshot, scenario)


def _apply_scenario(snapshot: RegistrySnapshot, scenario: str) -> RegistrySnapshot:
    result = copy.deepcopy(snapshot)
    devices = result.devices
    entities = result.entities
    states = result.states
    if scenario == "missing_entities":
        missing = {
            "number.dining_trv_external_temperature_input",
            "switch.dining_trv_smart_temperature_control",
        }
        entities = [item for item in entities if item["entity_id"] not in missing]
        states = [item for item in states if item["entity_id"] not in missing]
    elif scenario == "offline_sensor":
        for state in states:
            if state["entity_id"] == "sensor.kitchen_thermometer_temperature":
                state["state"] = "unavailable"
    elif scenario == "no_trvs":
        trv_ids = {device["id"] for device in devices if str(device["id"]).endswith("-trv")}
        devices = [device for device in devices if device["id"] not in trv_ids]
        trv_entities = {
            entity["entity_id"] for entity in entities if entity.get("device_id") in trv_ids
        }
        entities = [entity for entity in entities if entity.get("device_id") not in trv_ids]
        states = [state for state in states if state["entity_id"] not in trv_entities]
    return RegistrySnapshot(devices=devices, entities=entities, areas=result.areas, states=states)


class MockHomeAssistant:
    """Small Home Assistant protocol double used by the local harness and tests."""

    def __init__(self, scenario: str = "healthy"):
        if scenario not in SCENARIOS:
            raise ValueError(f"Unknown harness scenario: {scenario}")
        self.scenario = scenario
        self.room_values = {
            slug: {"sensor_temperature": temperature, "setpoint": 21.0, "hvac_mode": "heat"}
            for slug, _, temperature in ROOMS
        }
        self.relay_values = {"central_heating": "off", "hot_water": "off"}

    @property
    def snapshot(self) -> RegistrySnapshot:
        snapshot = build_snapshot(self.scenario)
        for state in snapshot.states:
            entity_id = state["entity_id"]
            for slug, values in self.room_values.items():
                sensor_id = f"sensor.{slug}_thermometer_temperature"
                climate_id = f"climate.{slug}_trv"
                local_id = f"sensor.{slug}_trv_local_temperature"
                if entity_id == sensor_id and state["state"] != "unavailable":
                    state["state"] = str(values["sensor_temperature"])
                elif entity_id == local_id:
                    state["state"] = str(round(float(values["sensor_temperature"]) - 0.4, 1))
                elif entity_id == climate_id:
                    state["state"] = values["hvac_mode"]
                    state["attributes"]["current_temperature"] = round(
                        float(values["sensor_temperature"]) - 0.4, 1
                    )
                    state["attributes"]["temperature"] = values["setpoint"]
                    state["attributes"]["hvac_action"] = (
                        "heating"
                        if values["hvac_mode"] == "heat"
                        and values["sensor_temperature"] < values["setpoint"]
                        else "idle"
                    )
            if entity_id == "switch.boiler_switch_central_heating_switch":
                state["state"] = self.relay_values["central_heating"]
            elif entity_id == "switch.boiler_switch_hot_water_switch":
                state["state"] = self.relay_values["hot_water"]
        return snapshot

    def _authorised(self, request: web.Request) -> bool:
        return request.headers.get("Authorization") == f"Bearer {TOKEN}"

    async def states(self, request: web.Request) -> web.Response:
        if not self._authorised(request):
            raise web.HTTPUnauthorized()
        return web.json_response(self.snapshot.states)

    async def websocket(self, request: web.Request) -> web.WebSocketResponse:
        socket = web.WebSocketResponse()
        await socket.prepare(request)
        await socket.send_json({"type": "auth_required", "ha_version": "2026.10.0"})
        try:
            auth = await socket.receive_json()
        except (TypeError, ValueError):
            await socket.close()
            return socket
        if auth != {"type": "auth", "access_token": TOKEN}:
            await socket.send_json({"type": "auth_invalid", "message": "Invalid access token"})
            await socket.close()
            return socket
        await socket.send_json({"type": "auth_ok", "ha_version": "2026.10.0"})

        async for message in socket:
            if message.type != WSMsgType.TEXT:
                continue
            payload = json.loads(message.data)
            snapshot = self.snapshot
            results = {
                "config/device_registry/list": snapshot.devices,
                "config/entity_registry/list": snapshot.entities,
                "config/area_registry/list": snapshot.areas,
            }
            command = payload.get("type")
            if command in results:
                response = {
                    "id": payload.get("id"),
                    "type": "result",
                    "success": True,
                    "result": results[command],
                }
            else:
                response = {
                    "id": payload.get("id"),
                    "type": "result",
                    "success": False,
                    "error": {"code": "unknown_command", "message": f"Unknown command: {command}"},
                }
            await socket.send_json(response)
        return socket

    async def control(self, request: web.Request) -> web.Response:
        buttons = "".join(
            f'<form method="post" action="/__harness/scenario/{html.escape(name)}">'
            f'<button class="{("active" if name == self.scenario else "")}" type="submit">'
            f"<strong>{html.escape(name.replace('_', ' ').title())}</strong>"
            f"<span>{html.escape(description)}</span></button></form>"
            for name, description in SCENARIOS.items()
        )
        current = html.escape(self.scenario.replace("_", " ").title())
        heating_url = f"http://127.0.0.1:{request.app['heating_port']}/"
        rooms = "".join(
            f"""<form class="room" method="post" action="/__harness/room/{slug}">
<h3>{html.escape(name)}</h3>
<label>Room sensor °C<input name="sensor_temperature" type="number" min="5" max="35"
step="0.1" value="{values["sensor_temperature"]}"></label>
<label>TRV set point °C<input name="setpoint" type="number" min="5" max="35"
step="0.5" value="{values["setpoint"]}"></label>
<label>TRV mode<select name="hvac_mode">
<option value="heat" {"selected" if values["hvac_mode"] == "heat" else ""}>Heat</option>
<option value="off" {"selected" if values["hvac_mode"] == "off" else ""}>Off</option>
</select></label><button type="submit">Apply</button></form>"""
            for slug, name, _ in ROOMS
            for values in (self.room_values[slug],)
        )
        relays = "".join(
            f"""<form method="post" action="/__harness/relay/{channel}">
<button type="submit"><strong>{html.escape(label)}</strong>
<span>Currently {self.relay_values[channel].upper()} — click to toggle</span></button></form>"""
            for channel, label in (
                ("central_heating", "Central heating relay"),
                ("hot_water", "Hot water relay"),
            )
        )
        body = f"""<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Home Heating simulator</title>
<style>
:root {{ font-family: system-ui; color: #e8f0ed; background: #0e1513; }}
body {{ max-width: 780px; margin: 48px auto; padding: 0 20px; }}
a {{ color: #70d5a4; }}
.grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 20px 0 32px; }}
form {{ margin: 0; }}
button {{
  background: #151e1b; border: 1px solid #34443e; border-radius: 12px;
  color: inherit; cursor: pointer; padding: 16px; text-align: left; width: 100%; height: 100%;
}}
button.active {{ border-color: #70d5a4; background: #172a23; }}
button strong, button span {{ display: block; }}
button span {{ color: #9dafa7; margin-top: 7px; line-height: 1.35; }}
.actions {{ display: flex; gap: 12px; align-items: center; }}
.room {{ background: #151e1b; border: 1px solid #34443e; border-radius: 12px; padding: 16px; }}
.room h3 {{ margin: 0 0 14px; }}
.room label {{ color: #9dafa7; display: grid; gap: 5px; margin: 10px 0; font-size: .85rem; }}
input, select {{ background: #0e1513; border: 1px solid #34443e; border-radius: 7px;
color: #e8f0ed; padding: 8px; }}
.room button {{ background: #70d5a4; color: #092017; height: auto; margin-top: 5px;
text-align: center; }}
@media(max-width: 600px) {{ .grid {{ grid-template-columns: 1fr; }} }}
</style></head><body>
<p>LOCAL SIMULATOR</p><h1>Imaginary Home Assistant</h1>
<p>Current scenario: <strong>{current}</strong>. Change it below, then use
“Rescan devices” in the add-on.</p>
<div class="grid">{buttons}</div>
<h2>Live device controls</h2>
<p>Change temperatures, target temperatures, modes, or relay states. The next API read sees
the new values immediately.</p>
<div class="grid">{rooms}</div>
<h2>Boiler switches</h2><div class="grid">{relays}</div>
<div class="actions"><a href="{heating_url}">Open Home Heating</a>
<form method="post" action="/__harness/reset">
<button type="submit">Reset saved configuration</button>
</form></div></body></html>"""
        return web.Response(text=body, content_type="text/html")

    async def select_scenario(self, request: web.Request) -> web.Response:
        scenario = request.match_info["scenario"]
        if scenario not in SCENARIOS:
            raise web.HTTPNotFound(text="Unknown scenario")
        self.scenario = scenario
        raise web.HTTPSeeOther("/")

    async def update_room(self, request: web.Request) -> web.Response:
        slug = request.match_info["slug"]
        if slug not in self.room_values:
            raise web.HTTPNotFound(text="Unknown room")
        form = await request.post()
        try:
            sensor_temperature = float(form["sensor_temperature"])
            setpoint = float(form["setpoint"])
        except (KeyError, TypeError, ValueError) as exc:
            raise web.HTTPBadRequest(text="Temperatures must be numbers") from exc
        if not 5 <= sensor_temperature <= 35 or not 5 <= setpoint <= 35:
            raise web.HTTPBadRequest(text="Temperatures must be between 5 and 35°C")
        hvac_mode = str(form.get("hvac_mode", ""))
        if hvac_mode not in {"heat", "off"}:
            raise web.HTTPBadRequest(text="TRV mode must be heat or off")
        self.room_values[slug] = {
            "sensor_temperature": sensor_temperature,
            "setpoint": setpoint,
            "hvac_mode": hvac_mode,
        }
        raise web.HTTPSeeOther("/")

    async def toggle_relay(self, request: web.Request) -> web.Response:
        channel = request.match_info["channel"]
        if channel not in self.relay_values:
            raise web.HTTPNotFound(text="Unknown relay")
        self.relay_values[channel] = "on" if self.relay_values[channel] == "off" else "off"
        raise web.HTTPSeeOther("/")

    async def reset_config(self, request: web.Request) -> web.Response:
        path: Path = request.app["config_path"]
        path.unlink(missing_ok=True)
        raise web.HTTPSeeOther("/")

    def create_app(
        self, *, heating_port: int = 8099, config_path: Path | None = None
    ) -> web.Application:
        app = web.Application()
        app["heating_port"] = heating_port
        app["config_path"] = config_path or ROOT / ".dev-data" / "heating-config.json"
        app.router.add_get("/", self.control)
        app.router.add_get("/api/states", self.states)
        app.router.add_get("/websocket", self.websocket)
        app.router.add_post("/__harness/scenario/{scenario}", self.select_scenario)
        app.router.add_post("/__harness/room/{slug}", self.update_room)
        app.router.add_post("/__harness/relay/{channel}", self.toggle_relay)
        app.router.add_post("/__harness/reset", self.reset_config)
        return app


async def _serve() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    ha_port = int(os.environ.get("HARNESS_HA_PORT", "18123"))
    heating_port = int(os.environ.get("HARNESS_APP_PORT", "8099"))
    config_path = Path(
        os.environ.get("HARNESS_CONFIG_PATH", ROOT / ".dev-data" / "heating-config.json")
    )
    static_dir = ROOT / "addon" / "frontend" / "dist"
    if not (static_dir / "index.html").exists():
        raise RuntimeError("Frontend is not built. Run `npm --prefix addon/frontend run build`.")

    mock = MockHomeAssistant(os.environ.get("HARNESS_SCENARIO", "healthy"))
    mock_runner = web.AppRunner(mock.create_app(heating_port=heating_port, config_path=config_path))
    await mock_runner.setup()
    await web.TCPSite(mock_runner, "127.0.0.1", ha_port).start()

    timeout = aiohttp.ClientTimeout(total=30)
    session = aiohttp.ClientSession(timeout=timeout)
    client = HomeAssistantClient(f"http://127.0.0.1:{ha_port}", TOKEN, session)
    heating = WebApplication(client, ConfigStore(config_path), static_dir=static_dir)
    heating_runner = web.AppRunner(heating.create())
    await heating_runner.setup()
    await web.TCPSite(heating_runner, "127.0.0.1", heating_port).start()

    print(f"\nHome Heating:       http://127.0.0.1:{heating_port}/")
    print(f"Device simulator:   http://127.0.0.1:{ha_port}/")
    print("Press Ctrl-C to stop.\n")
    try:
        await asyncio.Event().wait()
    finally:
        await heating_runner.cleanup()
        await session.close()
        await mock_runner.cleanup()


def main() -> None:
    with suppress(KeyboardInterrupt):
        asyncio.run(_serve())


if __name__ == "__main__":
    main()
