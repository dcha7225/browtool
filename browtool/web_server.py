"""FastAPI web server for BrowTool dashboard."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, template
from .playwright_script import coerce_launch_options

app = FastAPI(title="BrowTool Dashboard")


class RunToolRequest(BaseModel):
    name: str
    args: dict[str, Any] | None = None


class UpdateToolRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    script_text: str | None = None


def get_db():
    conn = db.connect()
    db.ensure_schema(conn)
    return conn


def get_frontend_path():
    """Get path to frontend directory."""
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
    return os.path.join(repo_root, "frontend")


@app.get("/")
async def index():
    """Serve the main dashboard HTML."""
    html_path = os.path.join(get_frontend_path(), "index.html")
    return FileResponse(html_path)


@app.get("/api/tools")
async def list_tools():
    """List all recorded tools with their parameters."""
    conn = get_db()
    tools = db.list_tools(conn)
    conn.close()

    result = []
    for tool in tools:
        params = template.extract_params(tool.script_text)
        result.append({
            "id": tool.id,
            "name": tool.name,
            "description": tool.description,
            "script_text": tool.script_text,
            "params": params,
            "created_at": tool.created_at,
            "updated_at": tool.updated_at,
        })
    return {"tools": result}


@app.get("/api/tools/{name}")
async def get_tool(name: str):
    """Get a single tool by name."""
    conn = get_db()
    tool = db.get_tool_by_name(conn, name)
    conn.close()

    if not tool:
        return {"error": f"Tool '{name}' not found"}, 404

    params = template.extract_params(tool.script_text)
    return {
        "id": tool.id,
        "name": tool.name,
        "description": tool.description,
        "script_text": tool.script_text,
        "params": params,
        "created_at": tool.created_at,
        "updated_at": tool.updated_at,
    }


@app.post("/api/tools/{name}/run")
async def run_tool(name: str, request: RunToolRequest):
    """Run a tool synchronously and return the result."""
    conn = get_db()
    tool = db.get_tool_by_name(conn, name)
    conn.close()

    if not tool:
        return {"error": f"Tool '{name}' not found"}, 404

    from .runner import run_python_script_text
    result = run_python_script_text(tool.script_text, args=request.args)

    return {
        "ok": result.ok,
        "exit_code": result.exit_code,
        "stdout": result.stdout,
        "stderr": result.stderr,
    }


@app.delete("/api/tools/{name}")
async def delete_tool(name: str):
    """Delete a tool by name."""
    conn = get_db()
    tool = db.get_tool_by_name(conn, name)
    if not tool:
        conn.close()
        return {"error": f"Tool '{name}' not found"}, 404

    conn.execute("DELETE FROM tools WHERE name = ?", (name,))
    conn.commit()
    conn.close()
    return {"ok": True, "deleted": name}


@app.put("/api/tools/{name}")
async def update_tool(name: str, request: UpdateToolRequest):
    """Update a tool's name, description, or script."""
    conn = get_db()
    tool = db.get_tool_by_name(conn, name)
    if not tool:
        conn.close()
        return {"error": f"Tool '{name}' not found"}, 404

    import time
    updates = []
    values = []

    if request.name is not None and request.name != name:
        updates.append("name = ?")
        values.append(request.name)
    if request.description is not None:
        updates.append("description = ?")
        values.append(request.description)
    if request.script_text is not None:
        updates.append("script_text = ?")
        values.append(request.script_text)

    if updates:
        updates.append("updated_at = ?")
        values.append(int(time.time()))
        values.append(name)

        conn.execute(
            f"UPDATE tools SET {', '.join(updates)} WHERE name = ?",
            values
        )
        conn.commit()

    conn.close()
    return {"ok": True}


@app.websocket("/ws/run/{name}")
async def websocket_run(websocket: WebSocket, name: str):
    """Run a tool with live output streaming via WebSocket."""
    await websocket.accept()

    try:
        # Receive args from client
        data = await websocket.receive_text()
        args = json.loads(data).get("args", {})

        conn = get_db()
        tool = db.get_tool_by_name(conn, name)
        conn.close()

        if not tool:
            await websocket.send_json({"type": "error", "message": f"Tool '{name}' not found"})
            await websocket.close()
            return

        # Render template
        try:
            script_text = template.render(tool.script_text, args)
        except KeyError as e:
            missing = str(e).strip("'")
            await websocket.send_json({"type": "error", "message": f"Missing required arg: {missing}"})
            await websocket.close()
            return

        # Coerce launch options
        script_text = coerce_launch_options(script_text, headless=False, slow_mo_ms=1000)

        await websocket.send_json({"type": "info", "message": f"Starting {name} with args={args}"})
        await websocket.send_json({"type": "action", "message": "Launching Chromium browser (headful mode)"})

        # Run in subprocess with live output
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "tool.py")
            with open(path, "w", encoding="utf-8") as f:
                f.write(script_text)

            process = await asyncio.create_subprocess_exec(
                sys.executable, path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            async def read_stream(stream, stream_type):
                while True:
                    line = await stream.readline()
                    if not line:
                        break
                    text = line.decode().rstrip()
                    if text:
                        await websocket.send_json({"type": stream_type, "message": text})

            # Read stdout and stderr concurrently
            await asyncio.gather(
                read_stream(process.stdout, "stdout"),
                read_stream(process.stderr, "stderr"),
            )

            exit_code = await process.wait()

            if exit_code == 0:
                await websocket.send_json({"type": "success", "message": "Tool completed successfully"})
            else:
                await websocket.send_json({"type": "error", "message": f"Tool failed with exit code {exit_code}"})

            await websocket.send_json({"type": "done", "exit_code": exit_code})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except:
            pass


def main():
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
