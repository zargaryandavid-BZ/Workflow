#!/usr/bin/env python3
"""Surface Open items from docs/bazaar-inbox.md (Bazaar Admin agent bus)."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

INBOX = Path("docs/bazaar-inbox.md")
STATE = Path(".cursor/hooks/.bazaar-inbox-state.json")
OPEN_RE = re.compile(r"^## Open\s*\n(.*?)(?=^## |\Z)", re.S | re.M)
TITLE_RE = re.compile(r"^### .+$", re.M)


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload))
    sys.exit(0)


def read_stdin() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def event_name(payload: dict) -> str:
    name = str(payload.get("hook_event_name") or "").strip()
    if name:
        return name
    if "status" in payload and "loop_count" in payload:
        return "stop"
    if "session_id" in payload:
        return "sessionStart"
    return ""


def open_body(text: str) -> str:
    match = OPEN_RE.search(text)
    if not match:
        return ""
    body = match.group(1).strip()
    if not body or body in {"_(none)_", "(none)"}:
        return ""
    if "### " not in body:
        return ""
    return body


def load_state() -> dict:
    if not STATE.exists():
        return {}
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def save_state(data: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(data), encoding="utf-8")


def titles(body: str) -> str:
    found = TITLE_RE.findall(body)
    return ", ".join(found) if found else "Open items"


def main() -> None:
    payload = read_stdin()
    event = event_name(payload)

    if not INBOX.is_file():
        emit({})

    opened = open_body(INBOX.read_text(encoding="utf-8"))

    if event == "sessionStart":
        if not opened:
            emit({})
        emit(
            {
                "additional_context": (
                    "Bazaar Admin wrote Open items in docs/bazaar-inbox.md. "
                    "Read that file and docs/workflow-bazaar-connect.md. "
                    "Kind Do: implement, then Answer (Workflow) and move to Done. "
                    "Kind Ask: open this repo's code (do not guess); reply yes/no "
                    "+ file path + what the code does; move to Done.\n\n" + opened
                )
            }
        )

    if event == "stop":
        if payload.get("status") != "completed":
            emit({})
        if not opened:
            if STATE.exists():
                STATE.unlink()
            emit({})
        digest = hashlib.sha256(opened.encode("utf-8")).hexdigest()
        state = load_state()
        if state.get("hash") == digest:
            emit({})
        save_state({"hash": digest})
        emit(
            {
                "followup_message": (
                    "Bazaar inbox update: docs/bazaar-inbox.md has Open items "
                    f"({titles(opened)}). Read docs/bazaar-inbox.md and "
                    "docs/workflow-bazaar-connect.md. Do: implement, Answer "
                    "(Workflow), move to Done. Ask: open this repo's code "
                    "(do not guess); yes/no + file path + what the code does; "
                    "move to Done."
                )
            }
        )

    emit({})


if __name__ == "__main__":
    main()
