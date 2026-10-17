#!/usr/bin/env python3
"""Derive safe publication settings from a Heat Steward release tag."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from typing import TextIO

SEMVER_TAG = re.compile(
    r"^v"
    r"(?P<major>0|[1-9]\d*)\."
    r"(?P<minor>0|[1-9]\d*)\."
    r"(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<prerelease>"
    r"(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*"
    r"))?$"
)


@dataclass(frozen=True)
class ReleaseMetadata:
    version: str
    prerelease: bool
    image_tags: tuple[str, ...]


def metadata_for_tag(tag: str) -> ReleaseMetadata:
    """Validate a release tag and select the container tags it may update."""
    match = SEMVER_TAG.fullmatch(tag)
    if match is None:
        raise ValueError(
            "Release tags must use vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-PRERELEASE"
        )
    version = tag.removeprefix("v")
    prerelease = match.group("prerelease") is not None
    return ReleaseMetadata(
        version=version,
        prerelease=prerelease,
        image_tags=(version,) if prerelease else (version, "latest"),
    )


def write_github_output(metadata: ReleaseMetadata, output: TextIO) -> None:
    """Write multiline-safe outputs for a GitHub Actions step."""
    print(f"version={metadata.version}", file=output)
    print(f"prerelease={str(metadata.prerelease).lower()}", file=output)
    print("image_tags<<EOF", file=output)
    print(*metadata.image_tags, sep="\n", file=output)
    print("EOF", file=output)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tag", help="Release tag, for example v0.37.0-rc.1")
    parser.add_argument(
        "--github-output",
        action="store_true",
        help="write GitHub Actions output syntax instead of JSON",
    )
    args = parser.parse_args()
    try:
        metadata = metadata_for_tag(args.tag)
    except ValueError as exc:
        parser.error(str(exc))
    if args.github_output:
        write_github_output(metadata, sys.stdout)
    else:
        print(json.dumps(asdict(metadata)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
