#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TOKEN = "dev-token"


def available_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, bytes, dict[str, str]]:
    data = json.dumps(payload).encode() if payload is not None else None
    request_headers = {"Accept": "application/json", **(headers or {})}
    if data is not None:
        request_headers["Content-Type"] = "application/json"
    http_request = urllib.request.Request(
        f"{base_url}{path}", data=data, headers=request_headers, method=method
    )
    try:
        with urllib.request.urlopen(http_request, timeout=5) as response:
            return response.status, response.read(), dict(response.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)


def request_json(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    expected: int = 200,
) -> dict[str, Any]:
    status, body, _ = request(base_url, path, method=method, payload=payload, headers=headers)
    if status != expected:
        raise AssertionError(
            f"{method} {path} returned {status}, expected {expected}: "
            f"{body.decode(errors='replace')}"
        )
    result = json.loads(body)
    if not isinstance(result, dict):
        raise AssertionError(f"{method} {path} did not return a JSON object")
    return result


def wait_for(description: str, check: Callable[[], bool], *, timeout: float = 45) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (AssertionError, OSError, urllib.error.URLError) as exc:
            last_error = exc
        time.sleep(0.25)
    detail = f": {last_error}" if last_error else ""
    raise AssertionError(f"Timed out waiting for {description}{detail}")


def docker(*arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", *arguments],
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def start_container(name: str, image: str, app_port: int, simulator_port: int, data: Path) -> None:
    result = docker(
        "run",
        "--detach",
        "--name",
        name,
        "--add-host",
        "host.docker.internal:host-gateway",
        "--publish",
        f"127.0.0.1:{app_port}:8099",
        "--volume",
        f"{data}:/data",
        "--env",
        f"SUPERVISOR_TOKEN={TOKEN}",
        "--env",
        f"HA_BASE_URL=http://host.docker.internal:{simulator_port}",
        "--env",
        "CONFIG_PATH=/data/heat-steward-config.json",
        image,
    )
    if not result.stdout.strip():
        raise AssertionError("Docker did not return a container ID")


def stop_container(name: str) -> None:
    docker("rm", "--force", name, check=False)


def container_logs(name: str) -> str:
    return docker("logs", name, check=False).stdout


def assert_frontend(app_url: str) -> None:
    status, body, _ = request(app_url, "/")
    html = body.decode(errors="replace")
    if status != 200 or "<title>Heat Steward</title>" not in html:
        raise AssertionError(f"Frontend did not load correctly ({status})")
    match = re.search(r'src="(\.?/assets/[^"]+\.js)"', html)
    if match is None:
        raise AssertionError("Frontend HTML did not reference a compiled JavaScript asset")
    asset_path = match.group(1).removeprefix(".")
    asset_status, asset, _ = request(app_url, asset_path)
    if asset_status != 200 or len(asset) < 1_000:
        raise AssertionError("Compiled frontend JavaScript asset did not load")


def configure_system(app_url: str) -> str:
    discovery = request_json(app_url, "/api/onboarding/discovery")
    trvs = discovery.get("trvs", [])
    if len(trvs) != 8:
        raise AssertionError(f"Expected 8 simulator TRVs, found {len(trvs)}")
    kitchen = next(item for item in trvs if item["name"] == "Kitchen TRV")
    device_id = str(kitchen["device_id"])

    request_json(
        app_url,
        "/api/onboarding",
        method="PUT",
        payload={
            "trvs": [
                {
                    "device_id": device_id,
                    "room_group": "Kitchen",
                    "external_temperature_sensor": "sensor.kitchen_thermometer_temperature",
                }
            ]
        },
    )
    request_json(
        app_url,
        "/api/boiler",
        method="PUT",
        payload={
            "boiler_switch": "switch.boiler_switch_central_heating_switch",
            "hot_water_switch": "switch.boiler_switch_hot_water_switch",
            "minimum_heat_requests": 1,
        },
    )
    request_json(
        app_url,
        "/api/schedules",
        method="PUT",
        payload={
            "schedules": [{"room_group": "Kitchen", "default_preset": "comfort", "periods": []}],
            "hot_water_schedule": {"default_state": "off", "periods": []},
        },
    )
    control = request_json(
        app_url,
        "/api/control",
        method="PUT",
        payload={
            "enabled": True,
            "cycle_interval_seconds": 10,
            "minimum_boiler_on_seconds": 0,
            "minimum_boiler_off_seconds": 0,
        },
    )
    if not control["config"]["control"]["enabled"]:
        raise AssertionError("Automatic control was not enabled")

    override = request_json(
        app_url,
        "/api/overrides/actions",
        method="POST",
        payload={
            "channel": "temperature",
            "scope_type": "room",
            "scope_id": device_id,
            "override_mode": "preset",
            "override_preset": "boost",
            "duration_minutes": 60,
        },
        headers={
            "Idempotency-Key": "smoke-room-boost",
            "X-Remote-User-Display-Name": "Smoke test",
        },
    )
    if override["overrides"]["temperature_overrides"][0]["preset"] != "boost":
        raise AssertionError("Boost override was not applied")
    return device_id


def assert_controlled(app_url: str, simulator_url: str) -> bool:
    dashboard = request_json(app_url, "/api/dashboard")
    room = dashboard["groups"][0]["rooms"][0]
    simulator = request_json(simulator_url, "/__harness/state")
    kitchen = next(item for item in simulator["rooms"] if item["slug"] == "kitchen")
    relays = {item["id"]: item["state"] for item in simulator["relays"]}
    return (
        room["preset"] == "boost"
        and dashboard["controller"]["enabled"] is True
        and kitchen["setpoint"] > 21
        and relays["central_heating"] == "on"
    )


def assert_persisted(app_url: str, device_id: str) -> None:
    config = request_json(app_url, "/api/config")
    if not config["configured"] or not config["config"]["control"]["enabled"]:
        raise AssertionError("Configuration was not restored after restart")
    if config["config"]["trvs"][0]["device_id"] != device_id:
        raise AssertionError("Configured radiator changed after restart")

    actions = request_json(app_url, "/api/overrides/actions")["actions"]
    if not any(action["action_id"] == "smoke-room-boost" for action in actions):
        raise AssertionError("Override action was not restored after restart")
    dashboard = request_json(app_url, "/api/dashboard")
    if dashboard["groups"][0]["rooms"][0]["preset"] != "boost":
        raise AssertionError("Active override was not replayed after restart")
    diagnostics = request_json(app_url, "/api/diagnostics")
    if not diagnostics.get("rooms"):
        raise AssertionError("Diagnostics did not include the configured room")


def run(image: str) -> None:
    app_port = available_port()
    simulator_port = available_port()
    app_url = f"http://127.0.0.1:{app_port}"
    simulator_url = f"http://127.0.0.1:{simulator_port}"
    container_name = f"heat-steward-smoke-{uuid.uuid4().hex[:10]}"

    with tempfile.TemporaryDirectory(prefix="heat-steward-smoke-") as temporary:
        data = Path(temporary) / "data"
        data.mkdir()
        simulator_log_path = Path(temporary) / "simulator.log"
        simulator_environment = os.environ.copy()
        python_path = str(ROOT / "addon" / "src")
        existing_python_path = simulator_environment.get("PYTHONPATH")
        simulator_environment["PYTHONPATH"] = f"{ROOT}{os.pathsep}{python_path}" + (
            f"{os.pathsep}{existing_python_path}" if existing_python_path else ""
        )
        simulator_environment.update(
            {
                "SIMULATOR_PORT": str(simulator_port),
                "SIMULATOR_HEATING_PORT": str(app_port),
                "SIMULATOR_CONFIG_PATH": str(data / "heat-steward-config.json"),
            }
        )

        with simulator_log_path.open("w+", encoding="utf-8") as simulator_log:
            simulator = subprocess.Popen(
                [sys.executable, "-m", "dev.simulator_server"],
                cwd=ROOT,
                env=simulator_environment,
                stdout=simulator_log,
                stderr=subprocess.STDOUT,
                text=True,
            )
            try:
                wait_for(
                    "the Home Assistant simulator",
                    lambda: request_json(simulator_url, "/__harness/state")["current_scenario"]
                    == "Healthy",
                )
                start_container(container_name, image, app_port, simulator_port, data)
                try:
                    wait_for(
                        "the Heat Steward container",
                        lambda: request_json(app_url, "/api/health")["status"] == "ok",
                    )
                    assert_frontend(app_url)
                    device_id = configure_system(app_url)
                    wait_for(
                        "simulated TRV and boiler commands",
                        lambda: assert_controlled(app_url, simulator_url),
                    )

                    stop_container(container_name)
                    start_container(container_name, image, app_port, simulator_port, data)
                    wait_for(
                        "the restarted Heat Steward container",
                        lambda: request_json(app_url, "/api/health")["status"] == "ok",
                    )
                    wait_for(
                        "persisted configuration and override replay",
                        lambda: (assert_persisted(app_url, device_id) or True),
                    )
                except Exception:
                    print("\nHeat Steward container logs:\n", container_logs(container_name))
                    raise
                finally:
                    stop_container(container_name)
            except Exception:
                simulator_log.flush()
                simulator_log.seek(0)
                print("\nSimulator logs:\n", simulator_log.read())
                raise
            finally:
                simulator.terminate()
                try:
                    simulator.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    simulator.kill()
                    simulator.wait(timeout=5)

    print("Smoke test passed: packaged UI, simulator control, persistence, and restart")


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke-test a packaged Heat Steward image")
    parser.add_argument("--image", default="heat-steward-smoke:local")
    arguments = parser.parse_args()
    run(arguments.image)


if __name__ == "__main__":
    main()
