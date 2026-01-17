from __future__ import annotations

import re
from typing import Any

_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z_]\w*)\s*\}\}")


def extract_params(template_text: str) -> list[str]:
    """Return placeholder names (e.g. {{arg1}} -> 'arg1') in first-seen order."""
    seen: set[str] = set()
    out: list[str] = []
    for m in _PLACEHOLDER_RE.finditer(template_text):
        name = m.group(1)
        if name not in seen:
            seen.add(name)
            out.append(name)
    return out


def render(template_text: str, args: dict[str, Any] | None) -> str:
    args = args or {}

    def repl(m: re.Match) -> str:
        name = m.group(1)
        if name not in args:
            raise KeyError(name)
        v = args[name]
        return "" if v is None else str(v)

    return _PLACEHOLDER_RE.sub(repl, template_text)

