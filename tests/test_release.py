"""Release boundary regressions, run on the admitted Jenkins worker."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_artifacts", ROOT / "scripts/fetch-release-artifacts.py")
artifacts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifacts)


class ReleaseChanges(unittest.TestCase):
    def test_release_decisions_and_errors(self):
        # Real git history catches the old [bot] regex bug and missing-tag errors.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "output"
            gh = root / "gh"
            gh.write_text('#!/bin/sh\nprintf "%s" "$FIXTURE_TAG"\nexit "$FIXTURE_API_EXIT"\n')
            gh.chmod(0o700)
            env = dict(os.environ, PATH=f"{root}:{os.environ['PATH']}", GITHUB_OUTPUT=str(output),
                       FIXTURE_TAG="v1", FIXTURE_API_EXIT="0")

            def git(*args):
                subprocess.run(["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", *args],
                               cwd=root, check=True, capture_output=True)

            def commit(email):
                git("-c", "user.name=Fixture", "-c", f"user.email={email}",
                    "commit", "--allow-empty", "-m", "fixture")

            def run():
                output.write_text("")
                return subprocess.run(["bash", str(ROOT / "scripts/release-changes.sh")],
                                      cwd=root, env=env, capture_output=True)

            git("init", "--quiet")
            commit("fixture@example.invalid")
            git("tag", "v1")
            for email in (None, "github-actions[bot]@users.noreply.github.com"):
                if email:
                    commit(email)
                self.assertEqual(run().returncode, 0)
                self.assertEqual(output.read_text(), "skip=true\n")
            commit("fixture@example.invalid")
            self.assertEqual(run().returncode, 0)
            self.assertEqual(output.read_text(), "skip=false\n")
            env["FIXTURE_TAG"] = ""
            self.assertEqual(run().returncode, 0)
            self.assertEqual(output.read_text(), "skip=false\n")
            for tag, api_exit in (("missing-tag", "0"), ("v1", "1")):
                env.update(FIXTURE_TAG=tag, FIXTURE_API_EXIT=api_exit)
                self.assertNotEqual(run().returncode, 0)
                self.assertEqual(output.read_text(), "")


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
