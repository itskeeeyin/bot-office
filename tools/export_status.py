#!/usr/bin/env python3
"""Write a public status.json from a local roster plus optional overrides.

This is the plug-in point for a live feed later. Replace ``load_roster`` with
a client for that source, then keep ``build_status`` as the gate: the file it
writes may contain bot names, zones, a coarse status, a short task label and
timestamps. It refuses message bodies, emails and other personal data instead
of copying them through.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

STATUSES = {"working", "idle", "blocked", "offline"}
PRIVATE_KEYS = {
    "email",
    "e_mail",
    "message",
    "messages",
    "body",
    "content",
    "prompt",
    "transcript",
    "phone",
    "address",
    "password",
    "secret",
    "token",
    "api_key",
    "apikey",
    "note",
    "notes",
    "dm",
    "chat",
    "mailbox",
}
EMAIL_RE = re.compile(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", re.IGNORECASE)
SECRET_RE = re.compile(r"(?i)(api[_ -]?key|password|secret|token)\s*[:=]")
MAX_NAME = 64
MAX_TASK = 80
MAX_ACTIVITY = 140


def load_roster(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in {".yaml", ".yml"}:
        data = parse_simple_yaml(text)
    else:
        data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("roster must be an object")
    return data


def parse_simple_yaml(text: str):
    """Parse the small roster subset: nested maps and lists of maps."""
    lines: list[tuple[int, str]] = []
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if raw.startswith("\t"):
            raise ValueError("YAML roster must be indented with spaces")
        indent = len(raw) - len(raw.lstrip(" "))
        lines.append((indent, stripped))

    def parse_block(index: int, indent: int):
        if index >= len(lines):
            return {}, index
        if lines[index][0] == indent and lines[index][1].startswith("- "):
            items = []
            while index < len(lines) and lines[index][0] == indent and lines[index][1].startswith("- "):
                first = lines[index][1][2:]
                index += 1
                key, sep, value = first.partition(":")
                if not sep:
                    raise ValueError(f"expected key in list item '{first}'")
                if value.strip() == "":
                    child, index = parse_block(index, indent + 2)
                    items.append(child)
                    continue
                node = {key.strip(): coerce(value)}
                while (
                    index < len(lines)
                    and lines[index][0] > indent
                    and not lines[index][1].startswith("- ")
                ):
                    child_key, child_sep, child_value = lines[index][1].partition(":")
                    if not child_sep:
                        raise ValueError(f"expected key in '{lines[index][1]}'")
                    if child_value.strip() == "":
                        child, index = parse_block(index + 1, lines[index][0] + 2)
                        node[child_key.strip()] = child
                    else:
                        node[child_key.strip()] = coerce(child_value)
                        index += 1
                items.append(node)
            return items, index
        node = {}
        while index < len(lines) and lines[index][0] == indent:
            key, sep, value = lines[index][1].partition(":")
            if not sep:
                raise ValueError(f"expected key in '{lines[index][1]}'")
            index += 1
            if value.strip() == "":
                child, index = parse_block(index, indent + 2)
                node[key.strip()] = child
            else:
                node[key.strip()] = coerce(value)
        return node, index

    tree, index = parse_block(0, 0)
    if index != len(lines):
        raise ValueError("could not parse the whole YAML roster")
    if not isinstance(tree, dict):
        raise ValueError("YAML roster must be a mapping")
    return tree


def coerce(value: str):
    text = value.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {'"', "'"}:
        return text[1:-1]
    return text


def build_status(roster: dict, overrides: dict | None = None, now: datetime | None = None) -> dict:
    assert_no_private(roster, "roster")
    if overrides:
        assert_no_private(overrides, "overrides")
    moment = now or datetime.now(timezone.utc)
    generated_at = moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    bots_in = roster.get("bots")
    if not isinstance(bots_in, list) or not bots_in:
        raise ValueError("roster needs a non-empty bots list")

    override_bots = {}
    if overrides:
        raw = overrides.get("bots", {})
        if not isinstance(raw, dict):
            raise ValueError("overrides.bots must be an object keyed by bot id")
        override_bots = raw

    seen: set[str] = set()
    bots = []
    for index, raw in enumerate(bots_in):
        if not isinstance(raw, dict):
            raise ValueError(f"bots[{index}] must be an object")
        bot_id = clean_text(raw.get("id"), MAX_NAME, f"bots[{index}].id")
        if bot_id in seen:
            raise ValueError(f"duplicate bot id {bot_id}")
        seen.add(bot_id)
        merged = dict(raw)
        extra = override_bots.get(bot_id)
        if extra is not None:
            if not isinstance(extra, dict):
                raise ValueError(f"override for {bot_id} must be an object")
            merged.update(extra)
        status = merged.get("status")
        if status not in STATUSES:
            raise ValueError(f"{bot_id} has status {status!r}; expected one of {sorted(STATUSES)}")
        last_active = merged.get("last_active") or generated_at
        if not isinstance(last_active, str) or "T" not in last_active:
            raise ValueError(f"{bot_id} last_active must be an ISO timestamp")
        bots.append(
            {
                "id": bot_id,
                "name": clean_text(merged.get("name"), MAX_NAME, f"{bot_id}.name"),
                "zone": clean_text(merged.get("zone"), MAX_NAME, f"{bot_id}.zone"),
                "status": status,
                "task": clean_text(merged.get("task"), MAX_TASK, f"{bot_id}.task"),
                "last_active": last_active.strip(),
            }
        )

    unknown = set(override_bots) - seen
    if unknown:
        raise ValueError(f"overrides mention unknown bots: {', '.join(sorted(unknown))}")

    activity = []
    for index, raw in enumerate(roster.get("activity") or []):
        if not isinstance(raw, dict):
            raise ValueError(f"activity[{index}] must be an object")
        bot_id = clean_text(raw.get("bot_id"), MAX_NAME, f"activity[{index}].bot_id")
        if bot_id not in seen:
            raise ValueError(f"activity[{index}] references unknown bot {bot_id}")
        ts = raw.get("ts")
        if not isinstance(ts, str) or "T" not in ts:
            raise ValueError(f"activity[{index}].ts must be an ISO timestamp")
        activity.append(
            {
                "ts": ts.strip(),
                "bot_id": bot_id,
                "text": clean_text(raw.get("text"), MAX_ACTIVITY, f"activity[{index}].text"),
            }
        )

    return {"generated_at": generated_at, "bots": bots, "activity": activity}


def assert_no_private(value, where: str) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            normalised = str(key).lower().replace("-", "_")
            if normalised in PRIVATE_KEYS:
                raise ValueError(f"refusing private field '{key}' in {where}")
            assert_no_private(item, where)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            assert_no_private(item, f"{where}[{index}]")
    elif isinstance(value, str):
        if EMAIL_RE.search(value) or SECRET_RE.search(value):
            raise ValueError(f"refusing personal or secret data in {where}")


def clean_text(value, limit: int, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    text = " ".join(value.split())
    if not text:
        raise ValueError(f"{field} is empty")
    if EMAIL_RE.search(text) or SECRET_RE.search(text):
        raise ValueError(f"refusing personal or secret data in {field}")
    if len(text) > limit:
        raise ValueError(f"{field} is longer than {limit} characters")
    return text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export a public bot-office status file")
    parser.add_argument("--roster", required=True, type=Path, help="YAML or JSON roster")
    parser.add_argument("--overrides", type=Path, help="Optional JSON overrides keyed by bot id")
    parser.add_argument("--out", type=Path, default=Path("public/status.json"), help="Output path, or - for stdout")
    args = parser.parse_args(argv)
    roster = load_roster(args.roster)
    overrides = None
    if args.overrides:
        overrides = json.loads(args.overrides.read_text(encoding="utf-8"))
        if not isinstance(overrides, dict):
            raise ValueError("overrides file must be an object")
    status = build_status(roster, overrides)
    payload = json.dumps(status, indent=2) + "\n"
    if str(args.out) == "-":
        sys.stdout.write(payload)
    else:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload, encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
