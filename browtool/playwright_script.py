from __future__ import annotations

import re


def coerce_launch_options(script_text: str, *, headless: bool = False, slow_mo_ms: int = 2000) -> str:
    """
    Best-effort post-processing for Playwright Python codegen output:
    - force headless=<bool>
    - force slow_mo=<ms> (adds delay between actions)
    """
    # Replace explicit assignments if present anywhere.
    script_text = re.sub(r"headless\s*=\s*True", f"headless={headless}", script_text)
    script_text = re.sub(r"headless\s*=\s*False", f"headless={headless}", script_text)
    script_text = re.sub(r"slow_mo\s*=\s*\d+", f"slow_mo={slow_mo_ms}", script_text)

    # If launch(...) has no headless/slow_mo kwarg, add them.
    def repl(m: re.Match) -> str:
        inner = m.group(1).strip()
        has_headless = "headless" in inner
        has_slow_mo = "slow_mo" in inner

        parts = [inner] if inner else []
        if not has_headless:
            parts.append(f"headless={headless}")
        if not has_slow_mo:
            parts.append(f"slow_mo={slow_mo_ms}")
        joined = ", ".join([p for p in parts if p])
        return f"launch({joined})"

    script_text = re.sub(r"launch\(([^)]*)\)", repl, script_text)
    return script_text

