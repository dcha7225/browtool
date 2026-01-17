from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass

from . import template
from .playwright_script import coerce_launch_options


@dataclass(frozen=True)
class RunResult:
    ok: bool
    exit_code: int
    stdout: str
    stderr: str


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
        with open(path, "w", encoding="utf-8") as f:
            f.write(script_text)

        proc = subprocess.run(
            [sys.executable, path],
            capture_output=True,
            text=True,
        )

        return RunResult(
            ok=proc.returncode == 0,
            exit_code=proc.returncode,
            stdout=proc.stdout or "",
            stderr=proc.stderr or "",
        )
