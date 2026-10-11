#!/usr/bin/env python3
"""Check that every published Heat Steward version agrees."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def addon_version() -> str:
    config = (ROOT / "addon/config.yaml").read_text(encoding="utf-8")
    match = re.search(r'^version:\s*["\']([^"\']+)["\']\s*$', config, re.MULTILINE)
    if match is None:
        raise RuntimeError("Could not find version in addon/config.yaml")
    return match.group(1)


def package_version(path: str) -> str:
    payload = json.loads((ROOT / path).read_text(encoding="utf-8"))
    version = payload.get("version")
    if not isinstance(version, str) or not version:
        raise RuntimeError(f"Could not find version in {path}")
    return version


def main() -> int:
    versions = {
        "addon/config.yaml": addon_version(),
        "addon/frontend/package.json": package_version("addon/frontend/package.json"),
        "addon/frontend/package-lock.json": package_version("addon/frontend/package-lock.json"),
    }
    unique_versions = set(versions.values())
    if len(unique_versions) != 1:
        for path, version in versions.items():
            print(f"{path}: {version}", file=sys.stderr)
        print("Release versions do not match", file=sys.stderr)
        return 1

    version = unique_versions.pop()
    expected = sys.argv[1].removeprefix("v") if len(sys.argv) > 1 else None
    if expected is not None and version != expected:
        print(
            f"Release tag version {expected} does not match repository version {version}",
            file=sys.stderr,
        )
        return 1

    changelog = (ROOT / "addon/CHANGELOG.md").read_text(encoding="utf-8")
    if re.search(rf"^## {re.escape(version)}(?:\s|$)", changelog, re.MULTILINE) is None:
        print(f"addon/CHANGELOG.md has no {version} release heading", file=sys.stderr)
        return 1

    print(f"Heat Steward version {version} is consistent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
