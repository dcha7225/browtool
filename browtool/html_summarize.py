from __future__ import annotations

import os
import re
from dataclasses import dataclass
from html import unescape
from typing import Any


@dataclass(frozen=True)
class HtmlDigest:
    title: str | None
    text: str
    links: list[dict[str, str]]


def _strip_tags(html: str) -> str:
    # Remove scripts/styles first
    html = re.sub(r"(?is)<script.*?>.*?</script>", " ", html)
    html = re.sub(r"(?is)<style.*?>.*?</style>", " ", html)
    # Basic tag strip
    html = re.sub(r"(?is)<[^>]+>", " ", html)
    text = unescape(html)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _extract_title(html: str) -> str | None:
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    if not m:
        return None
    t = unescape(m.group(1))
    t = re.sub(r"\s+", " ", t).strip()
    return t or None


def _extract_links(html: str, limit: int = 50) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for m in re.finditer(r'(?is)<a[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html):
        href = m.group(1).strip()
        text = _strip_tags(m.group(2))[:200]
        if href:
            out.append({"text": text, "href": href})
        if len(out) >= limit:
            break
    return out


def build_digest(html: str, *, max_text_chars: int = 20000) -> HtmlDigest:
    title = _extract_title(html)
    links = _extract_links(html)
    text = _strip_tags(html)
    if len(text) > max_text_chars:
        text = text[:max_text_chars]
    return HtmlDigest(title=title, text=text, links=links)


def digest_html(html: str, *, max_text_chars: int | None = None) -> dict[str, Any]:
    """
    Deterministic HTML -> digest for tool outputs.

    Returns:
      { ok: true, digest: { title, text, links } }
    """
    max_chars = max_text_chars or int(
        os.environ.get("BROWTOOL_HTML_MAX_CHARS", "20000"))
    digest = build_digest(html, max_text_chars=max_chars)
    return {"ok": True, "digest": digest.__dict__}
