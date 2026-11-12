import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import export_status  # noqa: E402


NOW = datetime(2026, 11, 12, 0, 0, tzinfo=timezone.utc)


def roster(**extra):
    base = {
        "bots": [
            {
                "id": "scout",
                "name": "Scout",
                "zone": "Research",
                "status": "idle",
                "task": "In the lounge",
            }
        ]
    }
    base.update(extra)
    return base


def test_yaml_roster_exports_only_public_fields():
    status = export_status.build_status(export_status.load_roster(ROOT / "tools" / "roster.sample.yaml"), now=NOW)
    assert set(status) == {"generated_at", "bots", "activity"}
    assert status["generated_at"] == "2026-11-12T00:00:00Z"
    assert len(status["bots"]) == 10
    assert {bot["zone"] for bot in status["bots"]} == {"Leadership", "Research", "Media", "Ops & Life"}
    scout = next(bot for bot in status["bots"] if bot["id"] == "scout")
    assert set(scout) == {"id", "name", "zone", "status", "task", "last_active"}
    assert scout["name"] == "Scout"
    assert status["activity"][0]["text"] == "Started the day at the desk"
    blob = json.dumps(status)
    assert "@" not in blob


def test_json_roster_and_overrides(tmp_path: Path):
    path = tmp_path / "roster.json"
    path.write_text(json.dumps(roster()), encoding="utf-8")
    loaded = export_status.load_roster(path)
    status = export_status.build_status(
        loaded,
        {"bots": {"scout": {"status": "blocked", "task": "Waiting on input"}}},
        now=NOW,
    )
    assert status["bots"][0]["status"] == "blocked"
    assert status["bots"][0]["task"] == "Waiting on input"


def test_rejects_email_and_message_fields():
    dirty = roster()
    dirty["bots"][0]["task"] = "Ping ada@example.com"
    with pytest.raises(ValueError, match="personal or secret"):
        export_status.build_status(dirty, now=NOW)

    messy = roster()
    messy["bots"][0]["message"] = "private thread"
    with pytest.raises(ValueError, match="private field"):
        export_status.build_status(messy, now=NOW)


def test_rejects_unknown_override_and_long_task():
    with pytest.raises(ValueError, match="unknown bots"):
        export_status.build_status(roster(), {"bots": {"missing": {"status": "idle"}}}, now=NOW)
    long_task = roster()
    long_task["bots"][0]["task"] = "x" * 81
    with pytest.raises(ValueError, match="longer than 80"):
        export_status.build_status(long_task, now=NOW)


def test_cli_writes_status(tmp_path: Path):
    roster_path = tmp_path / "roster.json"
    out = tmp_path / "status.json"
    roster_path.write_text(json.dumps(roster()), encoding="utf-8")
    code = export_status.main(["--roster", str(roster_path), "--out", str(out)])
    assert code == 0
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["bots"][0]["id"] == "scout"
    assert "message" not in json.dumps(written)
