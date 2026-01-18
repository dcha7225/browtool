from __future__ import annotations

import textwrap


def inject_html_capture(script_text: str, *, html_path: str) -> str:
    """
    Best-effort injection for Playwright Python codegen scripts.

    Writes final page HTML to `html_path` without failing the script if capture fails.
    Prefers inserting right before `browser.close()`. Falls back to appending at EOF.
    """
    # Insert before the earliest close call we can find, so `page.content()` still works.
    # Typical codegen does: context.close(); browser.close()
    markers = ["context.close()", "browser.close()", "page.close()"]
    lines = script_text.splitlines()

    insert_at = None
    indent = ""
    for i, line in enumerate(lines):
        if any(m in line for m in markers):
            insert_at = i
            indent = line[: len(line) - len(line.lstrip(" "))]
            break

    is_async = ("async_playwright" in script_text) or ("await " in script_text) or ("async def " in script_text)

    if is_async:
        injection = textwrap.dedent(
            f"""
            __BROWTOOL_HTML_PATH = r\"\"\"{html_path}\"\"\"
            try:
                _bt_page = locals().get(\"page\")
                _bt_ctx = locals().get(\"context\")
                if _bt_page is None and _bt_ctx is not None:
                    _bt_pages = getattr(_bt_ctx, \"pages\", None)
                    if _bt_pages:
                        _bt_page = _bt_pages[0]
                if _bt_page is not None:
                    # Wait for any pending navigation to complete
                    try:
                        await _bt_page.wait_for_load_state(\"load\", timeout=15000)
                    except Exception:
                        pass
                    # Wait for network to settle (dynamic content)
                    try:
                        await _bt_page.wait_for_load_state(\"networkidle\", timeout=10000)
                    except Exception:
                        pass
                    # Extra buffer for JS rendering
                    await _bt_page.wait_for_timeout(3000)
                    _bt_html = await _bt_page.content()
                    with open(__BROWTOOL_HTML_PATH, \"w\", encoding=\"utf-8\") as _bt_f:
                        _bt_f.write(_bt_html)
            except Exception:
                pass
            """
        ).strip("\n")
    else:
        injection = textwrap.dedent(
            f"""
            __BROWTOOL_HTML_PATH = r\"\"\"{html_path}\"\"\"
            try:
                _bt_page = locals().get(\"page\")
                _bt_ctx = locals().get(\"context\")
                if _bt_page is None and _bt_ctx is not None:
                    _bt_pages = getattr(_bt_ctx, \"pages\", None)
                    if _bt_pages:
                        _bt_page = _bt_pages[0]
                if _bt_page is not None:
                    # Wait for any pending navigation to complete
                    try:
                        _bt_page.wait_for_load_state(\"load\", timeout=15000)
                    except Exception:
                        pass
                    # Wait for network to settle (dynamic content)
                    try:
                        _bt_page.wait_for_load_state(\"networkidle\", timeout=10000)
                    except Exception:
                        pass
                    # Extra buffer for JS rendering
                    _bt_page.wait_for_timeout(3000)
                    _bt_html = _bt_page.content()
                    with open(__BROWTOOL_HTML_PATH, \"w\", encoding=\"utf-8\") as _bt_f:
                        _bt_f.write(_bt_html)
            except Exception:
                pass
            """
        ).strip("\n")

    injection_lines = [(indent + l if l.strip() else l) for l in injection.splitlines()]

    if insert_at is None:
        # Append at end with no indentation changes; safe but may be outside function scope.
        return script_text.rstrip() + "\n\n" + injection + "\n"

    new_lines = lines[:insert_at] + injection_lines + lines[insert_at:]
    return "\n".join(new_lines) + ("\n" if script_text.endswith("\n") else "")

