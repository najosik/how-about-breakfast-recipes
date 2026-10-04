#!/usr/bin/env python3
"""축제 이력 보관: culturalEventInfo 전체(약 5년 창) → data/festival_history.json

API는 오래된 행사를 지우는 것으로 보이므로(조회 시점 기준 약 5년), 지난 축제를 버리지 않고 쌓아 둔다.
- 축제(분류 '축제-*')만, 캘린더 예측에 필요한 필드만 보관(개인정보 없음)
- 기존 보관분은 API에서 사라져도 유지, 같은 id는 최신 값으로 갱신
- API 키는 환경변수 SEOUL_API_KEY로만 받고 출력하지 않는다(fetch_events와 동일)
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

import fetch_events as fe

HISTORY_PATH = Path(__file__).resolve().parent.parent / "data" / "festival_history.json"
KEEP = ("id", "title", "category", "district", "place", "start", "end", "org", "free", "link")
MAX_KEEP = 20000   # 비정상 증가 방지


def slim(ev: dict) -> dict:
    out = {k: ev.get(k) for k in KEEP}
    out["link"] = ev.get("link") or ev.get("homepage") or ""
    return out


def merge(existing: dict, rows: list[dict]) -> tuple[dict, int]:
    """기존 보관분 + API 원본 행 → (보관 사전, 새로 추가된 수)."""
    out = dict(existing)
    added = 0
    for row in rows:
        ev = fe.normalize(row)
        if not ev or not ev["category"].startswith("축제"):
            continue
        if ev["id"] not in out:
            added += 1
        out[ev["id"]] = slim(ev)
    if len(out) > MAX_KEEP:   # 가장 오래된 것부터 정리
        out = dict(sorted(out.items(), key=lambda kv: kv[1]["start"])[-MAX_KEEP:])
    return out, added


def fetch_all(key: str) -> list[dict]:
    total, rows = fe.extract(fe.fetch_page(key, 1, fe.PAGE_SIZE))
    pages = min(fe.MAX_PAGES, (total + fe.PAGE_SIZE - 1) // fe.PAGE_SIZE)
    for page in range(2, pages + 1):
        s = (page - 1) * fe.PAGE_SIZE + 1
        rows += fe.extract(fe.fetch_page(key, s, s + fe.PAGE_SIZE - 1))[1]
    return rows


def main() -> int:
    key = os.environ.get("SEOUL_API_KEY", "").strip()
    if not fe.KEY_RE.match(key):
        print("SEOUL_API_KEY is missing or malformed.", file=sys.stderr)
        return 2
    try:
        rows = fetch_all(key)
    except fe.FetchError as e:
        print(f"Fetch failed: {e}", file=sys.stderr)
        return 1
    existing = {}
    if HISTORY_PATH.exists():
        try:
            existing = json.loads(HISTORY_PATH.read_text("utf-8")).get("festivals", {})
        except (OSError, json.JSONDecodeError):
            print("Existing history unreadable; refusing to overwrite.", file=sys.stderr)
            return 1
    merged, added = merge(existing, rows)
    if len(merged) < len(existing):
        print("History would shrink; refusing to overwrite.", file=sys.stderr)
        return 1
    now = datetime.now(fe.KST).isoformat(timespec="seconds")
    fe.write_atomic(HISTORY_PATH, {"updatedAt": now, "source": "Seoul Open Data Plaza - culturalEventInfo (festivals only)",
                                   "count": len(merged), "festivals": dict(sorted(merged.items()))})
    print(f"Archived {added} new / {len(merged)} total festivals.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
