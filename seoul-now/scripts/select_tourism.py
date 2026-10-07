#!/usr/bin/env python3
"""1차 선별(관광부문): data/events.json → data/tourism_select.json

기준(예시, data/tourism_rules.json): 관광 가치·시민 수요는 규칙으로 판정하고,
시정 우선순위는 담당자 고정(pin)으로만 반영한다(정무 판단은 자동화하지 않음).
담당자 수정(data/tourism_overrides.json)이 규칙보다 우선: exclude > pin > 규칙.
원문은 데이터로만 다룬다(정해진 값과 대조만 함).
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
KST = timezone(timedelta(hours=9))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_calendar import series_key  # noqa: E402  같은 축제 묶기 규칙을 그대로 사용


def override_ids(items) -> set[str]:
    out = set()
    for x in items if isinstance(items, list) else []:
        v = x if isinstance(x, str) else (x.get("id") if isinstance(x, dict) else None)
        if isinstance(v, str):
            out.add(v)
    return out


def recurring_keys(history: dict, min_years: int) -> set[str]:
    years: dict[str, set] = {}
    for ev in history.values():
        if isinstance(ev, dict) and str(ev.get("start", ""))[:4].isdigit():
            years.setdefault(series_key(str(ev.get("title", ""))), set()).add(ev["start"][:4])
    return {k for k, ys in years.items() if len(ys) >= min_years and len(k) >= 2}


def judge(ev: dict, rules: dict, recurring: set[str]) -> dict:
    tv, cd = rules["tourism_value"], rules["citizen_demand"]
    value, demand = [], []
    if ev.get("district") in tv["hot_districts"]:
        value.append(f"관광 밀집 자치구({ev['district']})")
    if str(ev.get("category", "")).startswith(tv["festival_category_prefix"]):
        value.append("축제 분류")
    if series_key(str(ev.get("title", ""))) in recurring:
        value.append("반복 개최(축제 이력)")
    if cd.get("free") and ev.get("free") is True:
        demand.append("무료")
    target = str(ev.get("target") or "")
    if any(w in target for w in cd["open_audience_words"]):
        demand.append("누구나 참여")
    try:
        days = (date.fromisoformat(ev["end"]) - date.fromisoformat(ev["start"])).days + 1
    except (KeyError, ValueError):
        days = 0
    if days >= cd["long_run_days"]:
        demand.append(f"장기 운영({days}일)")
    p = rules["pass"]
    passed = len(value) >= p["min_tourism_value"] and len(value) + len(demand) >= p["min_total"]
    return {"pass": passed, "tourism_value": value, "citizen_demand": demand}


def select_all(events: list[dict], rules: dict, overrides: dict, history: dict) -> dict:
    recurring = recurring_keys(history, rules["tourism_value"]["recurring_min_years"])
    pin, exc = override_ids(overrides.get("pin")), override_ids(overrides.get("exclude"))
    out = {}
    for ev in events:
        eid = str(ev.get("id") or "")
        if not re.fullmatch(r"[0-9a-f]{6,40}", eid):
            continue
        r = judge(ev, rules, recurring)
        if eid in exc:
            r.update({"pass": False, "override": "exclude"})
        elif eid in pin:
            r.update({"pass": True, "override": "pin"})
        out[eid] = r
    return out


def write_atomic(path: Path, data: dict) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".sel-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def run(data_dir: Path = DATA, out_dir: Path | None = None) -> dict:
    """data_dir의 events.json(스냅샷이면 스냅샷 폴더)으로 선별. 규칙·담당자 수정·축제 이력은 해당 폴더에 없으면 data/ 것을 쓴다."""
    out_dir = out_dir or data_dir

    def read(name: str) -> dict:
        p = data_dir / name if (data_dir / name).exists() else DATA / name
        return json.loads(p.read_text("utf-8")) if p.exists() else {}

    rules = read("tourism_rules.json")
    sel = select_all(read("events.json").get("events", []), rules, read("tourism_overrides.json"),
                     read("festival_history.json").get("festivals", {}))
    payload = {"rules_version": rules["rules_version"], "is_example": rules.get("is_example", True),
               "updatedAt": datetime.now(KST).isoformat(timespec="seconds"),
               "count": len(sel), "passed": sum(1 for v in sel.values() if v["pass"]), "select": sel}
    write_atomic(out_dir / "tourism_select.json", payload)
    return payload

if __name__ == "__main__":
    p = run()
    print(f"tourism select: {p['passed']} / {p['count']} passed (rules {p['rules_version']})")
