from __future__ import annotations

import argparse
import inspect
import time
from typing import Any, Optional

from . import db
from .html_summarize import digest_html
from .runner import run_python_script_text
from .template import extract_params

# Phoenix/OpenTelemetry tracing (optional)
_tracer = None
_phoenix_session = None

def _init_phoenix():
    """Initialize Phoenix tracing if available (connects to running Phoenix collector)."""
    global _tracer, _phoenix_session
    try:
        from phoenix.otel import register
        from opentelemetry import trace

        # Connect to existing Phoenix collector (start with: python start_phoenix.py)
        register(project_name="browtool")
        _tracer = trace.get_tracer("browtool.mcp")
        print("Phoenix tracing enabled - sending to localhost:4317", file=__import__('sys').stderr)
    except ImportError:
        print("Phoenix not installed - tracing disabled", file=__import__('sys').stderr)
    except Exception as e:
        print(f"Phoenix init failed: {e} - tracing disabled", file=__import__('sys').stderr)


def _trace_tool_call(tool_name: str, args: dict | None = None):
    """Context manager for tracing tool calls."""
    if _tracer is None:
        from contextlib import nullcontext
        return nullcontext()

    from opentelemetry.trace import Status, StatusCode
    span = _tracer.start_span(f"mcp.tool.{tool_name}")
    span.set_attribute("tool.name", tool_name)
    span.set_attribute("tool.args", str(args or {}))
    span.set_attribute("tool.start_time", time.time())
    return span


def _end_trace(span, result: dict, error: Exception | None = None):
    """End a trace span with result info."""
    if span is None or _tracer is None:
        return

    from opentelemetry.trace import Status, StatusCode

    span.set_attribute("tool.end_time", time.time())
    span.set_attribute("tool.result.ok", result.get("ok", False))

    if error:
        span.set_status(Status(StatusCode.ERROR, str(error)))
        span.record_exception(error)
    else:
        span.set_status(Status(StatusCode.OK))

    span.end()


def build_mcp(db_path: Optional[str] = None, enable_phoenix: bool = True):
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

    # Initialize Phoenix tracing if enabled
    if enable_phoenix:
        _init_phoenix()

    conn = db.connect(db_path)
    db.ensure_schema(conn)

    @mcp.tool()
    def browtool_list_tools() -> list[dict[str, str]]:
        span = _trace_tool_call("browtool_list_tools")
        try:
            tools = db.list_tools(conn)
            result = [
                {
                    "name": t.name,
                    "description": t.description,
                    "params": ",".join(extract_params(t.script_text)),
                }
                for t in tools
            ]
            _end_trace(span, {"ok": True, "count": len(result)})
            return result
        except Exception as e:
            _end_trace(span, {"ok": False}, error=e)
            raise

    @mcp.tool()
    def browtool_run(name: str, args: dict | None = None) -> dict[str, Any]:
        span = _trace_tool_call("browtool_run", {"name": name, "args": args})
        try:
            tool = db.get_tool_by_name(conn, name)
            if not tool:
                result = {"ok": False, "error": f"Unknown tool: {name}"}
                _end_trace(span, result)
                return result
            res = run_python_script_text(tool.script_text, args=args)
            html_digest = None
            if res.html_text:
                try:
                    html_digest = digest_html(res.html_text)
                except Exception as e:
                    html_digest = {"ok": False, "error": str(e)}
            result = {
                "ok": res.ok,
                "exit_code": res.exit_code,
                "stdout": res.stdout,
                "stderr": res.stderr,
                "html_digest": html_digest,
            }
            _end_trace(span, result)
            return result
        except Exception as e:
            _end_trace(span, {"ok": False}, error=e)
            raise

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
            def _make_tool(script_text: str, tool_name: str):
                param_names = extract_params(script_text)

                def _tool(**kwargs) -> dict[str, Any]:
                    span = _trace_tool_call(tool_name, kwargs)
                    try:
                        res = run_python_script_text(script_text, args=kwargs)
                        html_digest = None
                        if res.html_text:
                            try:
                                html_digest = digest_html(res.html_text)
                            except Exception as e:
                                html_digest = {"ok": False, "error": str(e)}
                        result = {
                            "ok": res.ok,
                            "exit_code": res.exit_code,
                            "stdout": res.stdout,
                            "stderr": res.stderr,
                            "html_digest": html_digest,
                        }
                        _end_trace(span, result)
                        return result
                    except Exception as e:
                        _end_trace(span, {"ok": False}, error=e)
                        raise

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
                _make_tool(t.script_text, t.name))  # type: ignore
        except TypeError:
            # Older/other FastMCP variants may not accept name/description.
            break

    return mcp


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run browtool MCP server (stdio).")
    parser.add_argument("--db", dest="db_path",
                        help="Path to SQLite DB (default: db/browtool.sqlite)")
    parser.add_argument("--phoenix", action="store_true", default=False,
                        help="Enable Arize Phoenix tracing (http://localhost:6006)")
    parser.add_argument("--no-phoenix", dest="phoenix", action="store_false",
                        help="Disable Phoenix tracing")
    args = parser.parse_args(argv)

    mcp = build_mcp(args.db_path, enable_phoenix=args.phoenix)
    mcp.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
