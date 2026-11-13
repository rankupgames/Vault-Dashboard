"""Download the accepted commit's archived plugin files through Jenkins' read API."""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch_artifacts():
    repository = os.environ["GITHUB_REPOSITORY"]
    source = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    base = os.environ["JENKINS_URL"].rstrip("/")
    parsed = urlsplit(base)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment):
        raise SystemExit("The configured Jenkins HTTPS address is invalid.")
    reporter = os.environ["JENKINS_REPORTER_ID"]
    if not re.fullmatch(r"[1-9][0-9]*", reporter):
        raise SystemExit("The trusted Jenkins reporter ID is required.")
    pages = json.loads(subprocess.check_output([
        "gh", "api", f"repos/{repository}/commits/{source}/statuses?per_page=100",
        "--paginate", "--slurp",
    ], text=True))
    context = f"jenkins/{repository.split('/')[1]}/check"
    status = next((item for page in pages for item in page if item["context"] == context), None)
    if (status is None or status["state"] != "success"
            or str(status["creator"]["id"]) != reporter):
        raise SystemExit("Release requires a successful check from the trusted Jenkins reporter on HEAD.")
    build = status["target_url"]
    # Only a native build URL under the configured gateway may receive credentials.
    if not isinstance(build, str) or not re.fullmatch(
            re.escape(base) + r"/(?:job/[A-Za-z0-9_.-]+/)+[1-9][0-9]*/", build):
        raise SystemExit("The accepted Jenkins build URL is invalid.")
    required = ["JENKINS_USER", "JENKINS_TOKEN", "CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"]
    if any(not os.environ.get(key) or any(c in os.environ[key] for c in "\r\n\0") for key in required):
        raise SystemExit("Jenkins artifact reader and Cloudflare Access credentials are required.")
    identity = os.environ["JENKINS_USER"] + ":" + os.environ["JENKINS_TOKEN"]
    headers = {
        "Authorization": "Basic " + base64.b64encode(identity.encode()).decode(),
        "CF-Access-Client-Id": os.environ["CF_ACCESS_CLIENT_ID"],
        "CF-Access-Client-Secret": os.environ["CF_ACCESS_CLIENT_SECRET"],
    }
    opener = build_opener(ProxyHandler({}), NoRedirect())

    def read(path, limit):
        with opener.open(Request(build + path, headers=headers), timeout=60) as response:
            if response.status != 200:
                raise SystemExit("Jenkins artifact read was not successful.")
            data = response.read(limit + 1)
            if len(data) > limit:
                raise SystemExit("Jenkins artifact response exceeds the download limit.")
            return data

    metadata = json.loads(read("api/json?tree=result,building,actions[parameters[name,value]],artifacts[relativePath]", 1048576))
    revisions = [parameter["value"] for action in metadata["actions"]
                 for parameter in action.get("parameters", []) if parameter["name"] == "SOURCE_SHA"]
    if metadata["result"] != "SUCCESS" or metadata["building"] or revisions != [source]:
        raise SystemExit("The Jenkins build did not finish successfully on the selected commit.")
    files = ("main.js", "manifest.json", "styles.css")
    archived = [item["relativePath"] for item in metadata["artifacts"]]
    if any(archived.count(name) != 1 for name in files):
        raise SystemExit("The accepted Jenkins build is missing required plugin artifacts.")
    # Validate all downloads before changing any file used by the release.
    downloaded = {name: read("artifact/" + name, 64 * 1024 * 1024) for name in files}
    if any(not data for data in downloaded.values()):
        raise SystemExit("The accepted Jenkins build contains an empty plugin artifact.")
    if downloaded["manifest.json"] != Path("manifest.json").read_bytes():
        raise SystemExit("The archived manifest differs from the accepted source.")
    for name, data in downloaded.items():
        Path(name).write_bytes(data)
    print(f"Downloaded release artifacts for {source} from {build}")


if __name__ == "__main__":
    try:
        fetch_artifacts()
    except (HTTPError, URLError) as error:
        raise SystemExit("Jenkins artifact access failed. Check reader permissions and gateway access.") from error
