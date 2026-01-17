from __future__ import annotations

import argparse
import inspect
from typing import Any, Optional

from . import db
from .runner import run_python_script_text
from .template import extract_params


def build_mcp(db_path: Optional[str] = None):
    # Import here so `python -m browtool.record` works even if MCP deps aren't installed yet.
    try:
        from mcp.server.fastmcp import FastMCP  # type: ignore
    except ModuleNotFoundError as e:
        raise SystemExit(
            "Missing dependency: `mcp`.\n\n"
            "Fix:\n"
            "  python3 -m venv .venv\n"
            "  source .venv/bin/activate\n"
            "  pip install -r requirements.txt\n\n"
            "Then re-run:\n"
            "  python3 -m browtool.mcp_server\n"
        ) from e

    mcp = FastMCP("browtool")

    conn = db.connect(db_path)
    db.ensure_schema(conn)

    @mcp.tool()
    def browtool_list_tools() -> list[dict[str, str]]:
        tools = db.list_tools(conn)
        return [
            {
                "name": t.name,
                "description": t.description,
                "params": ",".join(extract_params(t.script_text)),
            }
            for t in tools
        ]

    @mcp.tool()
    def browtool_run(name: str, args: dict | None = None) -> dict[str, Any]:
        tool = db.get_tool_by_name(conn, name)
        if not tool:
            return {"ok": False, "error": f"Unknown tool: {name}"}
        res = run_python_script_text(tool.script_text, args=args)
        return {"ok": res.ok, "exit_code": res.exit_code, "stdout": res.stdout, "stderr": res.stderr}

    @mcp.tool()
    def browtool_reload_tools() -> dict[str, Any]:
        # FastMCP tool registration is typically static; treat this as a hint to restart.
        return {"ok": True, "message": "Reload not supported dynamically; restart the MCP server to reload tools from SQLite."}

    # Best-effort: register each recorded tool as its own MCP tool (nice UX in clients).
    # If the MCP SDK version doesn't support name/description args, clients still have `browtool_run`.
    tools = db.list_tools(conn)
    for t in tools:
        try:
            # Prefer explicit naming if supported by this SDK build.
            def _make_tool(script_text: str):
                param_names = extract_params(script_text)

                def _tool(**kwargs) -> dict[str, Any]:
                    res = run_python_script_text(script_text, args=kwargs)
                    return {"ok": res.ok, "exit_code": res.exit_code, "stdout": res.stdout, "stderr": res.stderr}

                # Expose placeholders as first-class MCP tool params.
                _tool.__signature__ = inspect.Signature(
                    [
                        inspect.Parameter(
                            p,
                            kind=inspect.Parameter.KEYWORD_ONLY,
                            default=inspect._empty,
                            annotation=str,
                        )
                        for p in param_names
                    ]
                )
                return _tool

            mcp.tool(name=t.name, description=t.description)(
                _make_tool(t.script_text))  # type: ignore
        except TypeError:
            # Older/other FastMCP variants may not accept name/description.
            break

    return mcp


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run browtool MCP server (stdio).")
    parser.add_argument("--db", dest="db_path",
                        help="Path to SQLite DB (default: db/browtool.sqlite)")
    args = parser.parse_args(argv)

    mcp = build_mcp(args.db_path)
    mcp.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
