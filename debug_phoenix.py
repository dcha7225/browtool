"""
Arize Phoenix debugging script for BrowTool MCP server.

Run this script to start a local Phoenix session for tracing and debugging.

Usage:
    python debug_phoenix.py

Then open http://localhost:6006 in your browser to view traces.
"""

import phoenix as px
from phoenix.otel import register
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
import functools
import time

# Launch Phoenix app (opens UI at localhost:6006)
session = px.launch_app()

# Configure OpenTelemetry to send traces to Phoenix
tracer_provider = register(project_name="browtool")
tracer = trace.get_tracer("browtool.debug")


def trace_tool(func):
    """Decorator to trace MCP tool executions."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        with tracer.start_as_current_span(f"tool.{func.__name__}") as span:
            span.set_attribute("tool.name", func.__name__)
            span.set_attribute("tool.args", str(args))
            span.set_attribute("tool.kwargs", str(kwargs))

            start_time = time.time()
            try:
                result = func(*args, **kwargs)
                span.set_attribute("tool.result", str(result)[:1000])
                span.set_status(Status(StatusCode.OK))
                return result
            except Exception as e:
                span.set_attribute("tool.error", str(e))
                span.set_status(Status(StatusCode.ERROR, str(e)))
                span.record_exception(e)
                raise
            finally:
                duration = time.time() - start_time
                span.set_attribute("tool.duration_ms", duration * 1000)

    return wrapper


def trace_browser_action(action_name: str):
    """Context manager for tracing browser actions."""
    return tracer.start_as_current_span(
        f"browser.{action_name}",
        attributes={"action.type": "browser"}
    )


def log_mcp_request(tool_name: str, args: dict = None):
    """Log an MCP tool request to Phoenix."""
    with tracer.start_as_current_span("mcp.request") as span:
        span.set_attribute("mcp.tool", tool_name)
        span.set_attribute("mcp.args", str(args or {}))
        return span


def example_usage():
    """Example showing how to use Phoenix tracing."""

    # Trace a simple operation
    with tracer.start_as_current_span("example.operation") as span:
        span.set_attribute("example.key", "value")
        print("Traced operation running...")
        time.sleep(0.1)
        span.set_attribute("example.status", "complete")

    # Trace a decorated function
    @trace_tool
    def sample_tool(query: str):
        time.sleep(0.05)
        return f"Result for: {query}"

    sample_tool("test query")

    # Trace browser action
    with trace_browser_action("navigate"):
        time.sleep(0.02)
        print("Simulated navigation...")

    print(f"\nPhoenix UI running at: {session.url}")
    print("Press Ctrl+C to stop")


if __name__ == "__main__":
    print("Starting Arize Phoenix for BrowTool debugging...")
    print(f"Phoenix UI: {session.url}")
    print("\nRunning example traces...")

    example_usage()

    # Keep the session alive
    try:
        input("\nPress Enter to exit...")
    except KeyboardInterrupt:
        pass

    print("Shutting down Phoenix...")
