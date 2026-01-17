from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from typing import Optional

from . import db
from .playwright_script import coerce_launch_options


def _prompt_if_missing(value: Optional[str], prompt: str) -> str:
    if value and value.strip():
        return value.strip()
    entered = input(prompt).strip()
    if not entered:
        raise SystemExit(f"Missing required value: {prompt}")
    return entered


def _coerce_headful_python_script(script_text: str) -> str:
    # Playwright Python codegen is typically headful, but enforce it just in case.
    # 1) Replace explicit headless=True
    script_text = re.sub(r"headless\s*=\s*True", "headless=False", script_text)

    # 2) If launch(...) has no headless kwarg, add headless=False.
    def repl(m: re.Match) -> str:
        inner = m.group(1)
        if "headless" in inner:
            return m.group(0)
        inner2 = inner.strip()
        if inner2:
            return f"launch({inner2}, headless=False)"
        return "launch(headless=False)"

    script_text = re.sub(r"launch\(([^)]*)\)", repl, script_text)
    return script_text


def run_codegen_python(url: str, out_path: str) -> None:
    # Uses the Playwright CLI from the Python package installation.
    # NOTE: codegen itself opens a headed browser UI; user closes it when done.
    cmd = [
        sys.executable,
        "-m",
        "playwright",
        "codegen",
        "--target",
        "python",
        "-o",
        out_path,
        url,
    ]
    subprocess.run(cmd, check=True)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Record a browtool workflow via Playwright codegen (Python).")
    parser.add_argument("--url", required=True,
                        help="URL to start codegen from")
    parser.add_argument("--name", help="Tool name (unique)")
    parser.add_argument("--description", help="Tool description")
    parser.add_argument("--db", dest="db_path",
                        help="Path to SQLite DB (default: db/browtool.sqlite)")
    args = parser.parse_args(argv)

    name = _prompt_if_missing(args.name, "Tool name: ")
    description = _prompt_if_missing(args.description, "Tool description: ")

    conn = db.connect(args.db_path)
    db.ensure_schema(conn)

    existing = db.get_tool_by_name(conn, name)
    if existing:
        raise SystemExit(f"Tool name already exists: {name}")

    with tempfile.TemporaryDirectory() as td:
        out_path = os.path.join(td, f"{name}.py")
        run_codegen_python(args.url, out_path)
        script_text = open(out_path, "r", encoding="utf-8").read()

    # Force headful + add 1s delay between actions via slow_mo.
    script_text = coerce_launch_options(
        script_text, headless=False, slow_mo_ms=1000)
    row = db.insert_tool(
        conn, name=name, description=description, script_text=script_text)

    print(f"Recorded tool: {row.name}")
    print(f"DB: {args.db_path or db.default_db_path()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
