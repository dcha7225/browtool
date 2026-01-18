# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BrowTool is a browser automation tool that:
1. **Records** browser workflows via Playwright Python codegen
2. **Stores** recorded scripts in SQLite with parameterization support (`{{placeholder}}` syntax)
3. **Replays** workflows via an MCP server that AI agents can call

## Quick Start

```bash
# Setup
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium

# Record a tool
./recorder.sh https://www.wikipedia.org/
# Or with options:
python3 -m browtool.record --url https://www.wikipedia.org/ --name wiki_search --description "Search wikipedia"

# Run MCP server (stdio)
python3 -m browtool.mcp_server
```

## Architecture

```
Playwright codegen → SQLite (db/browtool.sqlite) → MCP Server → AI Agents
```

### Module Structure
- **browtool/record.py** - Launches Playwright codegen, prompts for name/description, stores script in DB
- **browtool/runner.py** - Executes stored scripts with parameter substitution, enforces `slow_mo=1000`
- **browtool/mcp_server.py** - FastMCP server exposing tools: `browtool_list_tools`, `browtool_run`, plus individual tool endpoints
- **browtool/db.py** - SQLite operations for tools table (id, name, description, script_text, timestamps)
- **browtool/template.py** - `{{placeholder}}` extraction and substitution
- **browtool/playwright_script.py** - Post-processes scripts to force headful mode and slow_mo

### MCP Tools Exposed
- `browtool_list_tools()` - List all recorded tools with params
- `browtool_run(name, args)` - Run a tool by name with optional args dict
- Each recorded tool is also registered as its own MCP tool with extracted parameters

### Parameterization
Use `{{param_name}}` placeholders in recorded scripts. The template system in `browtool/template.py` extracts these and exposes them as MCP tool parameters. Example:
```python
page.get_by_role("searchbox").fill("{{query}}")
```
This exposes `query` as an MCP tool parameter.

## Storage

- **Database**: `db/browtool.sqlite`
- **Table**: `tools` (id, name, description, script_text, created_at, updated_at)

## Replay Behavior
- All replays run **headful** (visible browser window)
- 1-second delay between actions (`slow_mo=1000`)
- Scripts executed in temp directory via subprocess

## Future: LeanMCP Deployment

For production deployment, plan to use [LeanMCP](https://docs.leanmcp.com/) (nexhack sponsor):

```bash
npm install -g @leanmcp/cli
leanmcp login
leanmcp init browtool-server
leanmcp deploy
```

### Migration Considerations
- **Option A**: Keep Python, deploy MCP server as-is (self-hosted or containerized)
- **Option B**: Convert to TypeScript using `@leanmcp/core` SDK for full LeanMCP platform features
- **Browser execution**: For headless cloud deployment, consider [Browserbase](https://browserbase.com/) or similar cloud browser service since LeanMCP runs at edge

### LeanMCP TypeScript Pattern (if migrating)
```typescript
import { MCPServer, createHTTPServer, Tool, Service } from "@leanmcp/core";

@Service()
class BrowserTools {
  @Tool("Search Wikipedia for a topic")
  async searchWikipedia(query: string) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto("https://wikipedia.org");
    await page.getByRole("searchbox").fill(query);
    await page.getByRole("button", { name: "Search" }).click();
    // ... extract and return results
    await browser.close();
    return { title, summary, url };
  }
}

const server = new MCPServer({ name: "browtool", version: "1.0.0" });
await createHTTPServer(() => server.getServer(), { port: 3001 });
```

## Useful References

- [LeanMCP Docs](https://docs.leanmcp.com/) - SDK and deployment
- [Playwright Codegen](https://playwright.dev/docs/codegen) - Recording tool
- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) - Reference implementation
- [playwright-codegen-mcp](https://github.com/d-kimuson/playwright-codegen-mcp) - Codegen-to-MCP bridge pattern
- [Browserbase](https://browserbase.com/mcp) - Cloud browser infrastructure

## Key Decisions Needed

1. **Output extraction** - How to capture meaningful return values from page content (currently just stdout/stderr)
2. **Error handling** - Retry logic, timeout handling, bot detection fallbacks
3. **Deployment target** - Python self-hosted vs TypeScript on LeanMCP
4. **Browser hosting** - Local Playwright vs cloud browsers (Browserbase) for production
