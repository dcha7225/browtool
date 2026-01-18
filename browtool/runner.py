from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass

from . import template
from .html_capture import inject_html_capture
from .playwright_script import coerce_launch_options


@dataclass(frozen=True)
class RunResult:
    ok: bool
    exit_code: int
    stdout: str
    stderr: str
    html_path: str | None = None
    html_size_bytes: int | None = None
    html_excerpt: str | None = None
    html_text: str | None = None


def run_python_script_text(script_text: str, *, args: dict | None = None) -> RunResult:
    try:
        script_text = template.render(script_text, args)
    except KeyError as e:
        missing = str(e).strip("'")
        return RunResult(ok=False, exit_code=2, stdout="", stderr=f"Missing required arg: {missing}\n")

    # Add a 1s delay between Playwright actions by forcing slow_mo on browser launch.
    # (Also reinforces headful execution for older scripts.)
    script_text = coerce_launch_options(
        script_text, headless=False, slow_mo_ms=1000)

    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "tool.py")
        html_path = os.path.join(td, "artifact.html")

        # Inject final HTML capture (best-effort) into the script itself.
        script_text = inject_html_capture(script_text, html_path=html_path)
        with open(path, "w", encoding="utf-8") as f:
            f.write(script_text)

        proc = subprocess.run(
            [sys.executable, path],
            capture_output=True,
            text=True,
        )

        html_excerpt = None
        html_size = None
        html_text = None
        if os.path.exists(html_path):
            try:
                b = open(html_path, "rb").read()
                html_size = len(b)
                html_excerpt = b[:2000].decode("utf-8", errors="replace")
                max_bytes = int(os.environ.get(
                    "BROWTOOL_HTML_CAPTURE_MAX_BYTES", "2000000"))
                html_text = b[:max_bytes].decode("utf-8", errors="replace")
            except Exception:
                html_excerpt = None
                html_size = None
                html_text = None

        return RunResult(
            ok=proc.returncode == 0,
            exit_code=proc.returncode,
            stdout=proc.stdout or "",
            stderr=proc.stderr or "",
            html_path=html_path if os.path.exists(html_path) else None,
            html_size_bytes=html_size,
            html_excerpt=html_excerpt,
            html_text=html_text,
        )
