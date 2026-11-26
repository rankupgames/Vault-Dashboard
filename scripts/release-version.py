"""Select the version committed in the plugin manifest for publication."""
import json
import os
from pathlib import Path
import re
import subprocess


def parse_version(value):
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){2}", value):
        raise SystemExit(f"Expected a release version in x.y.z format, got {value!r}.")
    return tuple(map(int, value.split(".")))


def select_release():
    version = json.loads(Path("manifest.json").read_text(encoding="utf-8"))["version"]
    candidate = parse_version(version)
    releases = json.loads(subprocess.check_output([
        "gh", "release", "list", "--exclude-drafts", "--exclude-pre-releases",
        "--limit", "1", "--json", "tagName",
    ], text=True))
    if not isinstance(releases, list) or len(releases) > 1:
        raise SystemExit("GitHub returned an unexpected release list.")
    latest = parse_version(releases[0]["tagName"]) if releases else None
    if latest is not None and candidate < latest:
        raise SystemExit("The manifest version is older than the latest published release.")
    if candidate == latest:
        print(f"::notice::Version {version} is already published. Skipping release.")
        return
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
        output.write(f"version={version}\n")


if __name__ == "__main__":
    select_release()
