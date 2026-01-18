#!/usr/bin/env python3
"""
Start Phoenix collector for BrowTool tracing.

Run this BEFORE using browtool MCP tools to capture traces.

Usage:
    python start_phoenix.py

Then open http://localhost:6006 to view traces.
"""

import phoenix as px

print("Starting Arize Phoenix collector...")
print("This will collect traces from BrowTool MCP server.")
print()

session = px.launch_app()

print(f"Phoenix UI: {session.url}")
print()
print("Keep this running while using BrowTool.")
print("Press Ctrl+C to stop.")
print()

import time
try:
    while True:
        time.sleep(60)
except KeyboardInterrupt:
    pass

print("Shutting down Phoenix...")
