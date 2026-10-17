from __future__ import annotations

from io import StringIO

import pytest

from scripts.release_metadata import metadata_for_tag, write_github_output


def test_stable_release_updates_version_and_latest_tags() -> None:
    metadata = metadata_for_tag("v0.37.0")

    assert metadata.version == "0.37.0"
    assert metadata.prerelease is False
    assert metadata.image_tags == ("0.37.0", "latest")


def test_prerelease_only_updates_its_exact_image_tag() -> None:
    metadata = metadata_for_tag("v0.37.0-rc.1")

    assert metadata.version == "0.37.0-rc.1"
    assert metadata.prerelease is True
    assert metadata.image_tags == ("0.37.0-rc.1",)


@pytest.mark.parametrize(
    "tag",
    (
        "0.37.0",
        "v0.37",
        "v0.37.0-",
        "v0.37.0-rc+build",
        "v01.37.0",
    ),
)
def test_invalid_release_tag_is_rejected(tag: str) -> None:
    with pytest.raises(ValueError, match="Release tags must use"):
        metadata_for_tag(tag)


def test_github_output_preserves_multiline_image_tags() -> None:
    output = StringIO()

    write_github_output(metadata_for_tag("v0.37.0"), output)

    assert output.getvalue() == (
        "version=0.37.0\nprerelease=false\nimage_tags<<EOF\n0.37.0\nlatest\nEOF\n"
    )
