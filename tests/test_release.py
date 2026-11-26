"""Release boundary regressions for local checks and Jenkins."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_artifacts", ROOT / "scripts/fetch-release-artifacts.py")
artifacts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifacts)
version_spec = importlib.util.spec_from_file_location("release_version", ROOT / "scripts/release-version.py")
release_version = importlib.util.module_from_spec(version_spec)
version_spec.loader.exec_module(release_version)


class ReleaseVersion(unittest.TestCase):
    def test_only_unreleased_manifest_versions_are_selected(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(release_version, "Path") as paths, \
                patch.object(release_version.subprocess, "check_output") as api:
            root = Path(directory)
            output = root / "output"
            manifest = root / "manifest.json"
            paths.side_effect = lambda name: root / name
            manifest.write_text('{"version":"1.1.10"}', encoding="utf-8")
            with patch.dict(os.environ, {"GITHUB_OUTPUT": str(output)}):
                for latest in ([], [{"tagName": "1.1.9"}]):
                    api.return_value = json.dumps(latest)
                    release_version.select_release()
                    self.assertEqual(output.read_text(), "version=1.1.10\n")
                    output.unlink()

                api.return_value = '[{"tagName":"1.1.10"}]'
                release_version.select_release()
                self.assertFalse(output.exists())

                for tag in ("1.1.11", "1.1.9-beta"):
                    api.return_value = json.dumps([{"tagName": tag}])
                    with self.assertRaises(SystemExit):
                        release_version.select_release()
                    self.assertFalse(output.exists())

                api.side_effect = subprocess.CalledProcessError(1, "gh")
                with self.assertRaises(subprocess.CalledProcessError):
                    release_version.select_release()
                self.assertFalse(output.exists())


class ArtifactDownload(unittest.TestCase):
    def test_only_successful_exact_commit_artifacts_are_written(self):
        source = "a" * 40
        base = "https://jenkins.example.invalid"
        build = base + "/job/fixture/job/check/1/"
        status = {"context": "jenkins/plugin/check", "state": "success",
                  "creator": {"id": 1}, "target_url": build}
        metadata = {"result": "SUCCESS", "building": False,
                    "actions": [{"parameters": [{"name": "SOURCE_SHA", "value": source}]}],
                    "artifacts": [{"relativePath": name} for name in ("main.js", "manifest.json", "styles.css")]}
        payloads = {"main.js": b"plugin", "styles.css": b"styles", "manifest.json": b'{"version":"1"}\n'}
        env = {"GITHUB_REPOSITORY": "fixture/plugin", "JENKINS_URL": base, "JENKINS_REPORTER_ID": "1",
               "JENKINS_USER": "fixture", "JENKINS_TOKEN": "synthetic", "CF_ACCESS_CLIENT_ID": "fixture",
               "CF_ACCESS_CLIENT_SECRET": "synthetic"}

        def command(args, **kwargs):
            return source if args[0] == "git" else json.dumps([[status]])

        def open_request(request, **kwargs):
            # The gateway rejects urllib's default identity before Access evaluates the credentials.
            if request.get_header("User-agent", "Python-urllib").startswith("Python-urllib"):
                raise HTTPError(request.full_url, 403, "Gateway rejected default User-Agent", {}, None)
            response = io.BytesIO(json.dumps(metadata).encode() if "/api/json?" in request.full_url
                                  else payloads[request.full_url.rsplit("/", 1)[1]])
            response.status = 200
            return response

        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, env), \
                patch.object(artifacts.subprocess, "check_output", side_effect=command), \
                patch.object(artifacts, "build_opener") as opener, patch.object(artifacts, "Path") as paths:
            root = Path(directory)
            (root / "manifest.json").write_bytes(payloads["manifest.json"])
            paths.side_effect = lambda name: root / name
            opener.return_value.open.side_effect = open_request
            # Refuse the newest pending status, a foreign reporter, a foreign host,
            # a wrong revision, a failed build, missing files and a changed manifest.
            cases = [(status, "state", "pending"), (status, "creator", {"id": 2}),
                     (status, "target_url", "https://foreign.example.invalid/job/check/1/"),
                     (metadata, "actions", []), (metadata, "result", "FAILURE"),
                     (metadata, "artifacts", []), (payloads, "manifest.json", b"different")]
            for mapping, key, invalid in cases:
                original = mapping[key]
                mapping[key] = invalid
                with self.assertRaises(SystemExit):
                    artifacts.fetch_artifacts()
                self.assertFalse((root / "main.js").exists())
                self.assertEqual((root / "manifest.json").read_bytes(), b'{"version":"1"}\n')
                mapping[key] = original
            artifacts.fetch_artifacts()
            self.assertEqual({name: (root / name).read_bytes() for name in payloads}, payloads)
