## browTool (Playwright recorder + MCP replayer)

This repo lets you:

- **Record** a browser workflow via Playwright **Python** codegen
- Persist the generated script to **SQLite**
- **Replay** recorded workflows via an **MCP server** (headed browser)

### Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install
```

### Record a tool

```bash
./recorder.sh https://www.wikipedia.org/
```

You can also run the recorder directly:

```bash
python3 -m browtool.record --url https://www.wikipedia.org/ --name wiki_search --description "Search wikipedia"
```

### Run the MCP server (stdio)

```bash
python3 -m browtool.mcp_server
```

### Where tools are stored

- SQLite DB: `db/browtool.sqlite`
- Table: `tools` (name, description, script_text, timestamps)

### Params via placeholders

If your recorded script contains placeholders like `{{arg1}}`, browtool will:

- Expose `arg1` as an MCP tool parameter
- Substitute the provided value into the script right before replay

### 1-second delay between steps

Replays run with Playwright `slow_mo=1000` enforced, which adds an ~1s delay between actions.
