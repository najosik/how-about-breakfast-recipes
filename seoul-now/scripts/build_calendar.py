#!/usr/bin/env python3
"""축제 예상 캘린더: data/festival_history.json → data/calendar_<연도>.json

해마다 열린 축제를 제목으로 묶고(연도·회차·기관 표기 제거), 지난 개최 시기로 대상 연도의 시기를 예측한다.
- 확정(confirmed): 대상 연도 일정이 이미 API에 올라온 경우
- 예상 높음(high): 최근 3개 연도 이상, 시작일 편차 21일 이내
- 예상 보통(medium): 2개 연도 이상, 편차 35일 이내
- 예상 낮음(low): 반복은 되지만 시기가 들쭉날쭉
최근 2년 안에 열리지 않은 축제는 중단 가능성이 있어 제외한다. 예측은 참고용이며 실제 일정과 다를 수 있다.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median

KST = timezone(timedelta(hours=9))
DATA = Path(__file__).resolve().parent.parent / "data"
HISTORY_PATH = DATA / "festival_history.json"
LOOKBACK = 5

BRACKETS = re.compile(r"\[[^\]]*\]|【[^】]*】|<[^>]*>|\([^)]*\)|（[^）]*）")
YEARS = re.compile(r"(?<!\d)(19|20)\d{2}(?!\d)\s*년?|'\d{2}(?!\d)")
ROUNDS = re.compile(r"제?\s*\d{1,3}\s*(회|번째|기)|\b\d{1,3}(st|nd|rd|th)\b", re.I)
NON_WORD = re.compile(r"[^0-9a-z가-힣]+", re.I)
SPACES = re.compile(r"\s{2,}")
# 축제 자체가 아닌 모집·공모 공지는 캘린더에서 뺀다
NOT_EVENT = re.compile(r"모집|공모|서포터즈|자원봉사|봉사자|참가\s*신청")
SUFFIX = re.compile(r"(축제|페스티벌|festival|페스타|festa)$")
# 앞에 붙는 자치구 이름(예: '중랑 서울장미축제' = '서울장미축제')은 같은 축제로 본다
# 음력 명절 행사는 해마다 양력 날짜가 크게 바뀐다
LUNAR = re.compile(r"설날|설\s*맞이|설축제|추석|한가위|단오|정월|대보름|동지")
GU_PREFIX = re.compile(r"^(강남|강동|강북|강서|관악|광진|구로|금천|노원|도봉|동대문|동작|마포|서대문|서초|성동|성북|송파|양천|영등포|용산|은평|종로|중구|중랑)(구)?")


def series_key(title: str) -> str:
    t = BRACKETS.sub(" ", title.lower())
    t = ROUNDS.sub(" ", YEARS.sub(" ", t))
    k = NON_WORD.sub("", t)
    trimmed = SUFFIX.sub("", k)
    k = trimmed if len(trimmed) >= 3 else k
    no_gu = GU_PREFIX.sub("", k)
    return no_gu if len(no_gu) >= 4 else k


def display_name(title: str) -> str:
    """최신 제목에서 연도·회차·기관 괄호를 뺀 이름. 다 지워지면 원제목."""
    t = re.sub(r"^\s*(\[[^\]]*\]\s*)+", "", title)
    t = ROUNDS.sub(" ", YEARS.sub(" ", t))
    t = re.sub(r"\(\s*([^)]*?)\s*\)", r"(\1)", t).replace("()", "")
    t = SPACES.sub(" ", t).strip(" -·:,")
    return t or title


def doy(iso: str) -> int:
    """윤년 영향을 없앤 연중 일차(2001년 기준)."""
    return date(2001, int(iso[5:7]), min(int(iso[8:10]), 28 if iso[5:7] == "02" else 31)).timetuple().tm_yday


def part_of_month(day: int) -> str:
    return "early" if day <= 10 else "mid" if day <= 20 else "late"


def forecast(festivals: dict, target: int) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for ev in festivals.values():
        if not isinstance(ev, dict) or not str(ev.get("start", ""))[:4].isdigit():
            continue
        if NOT_EVENT.search(str(ev.get("title", ""))):
            continue
        key = series_key(str(ev.get("title", "")))
        if len(key) >= 2:
            groups[key].append(ev)

    out = []
    for key, evs in groups.items():
        evs.sort(key=lambda e: e["start"])
        by_year: dict[int, list[dict]] = defaultdict(list)
        for e in evs:
            by_year[int(e["start"][:4])].append(e)
        latest = evs[-1]
        past = {y: v[0] for y, v in by_year.items() if target - LOOKBACK <= y < target}
        base = {"id": hashlib.sha1(key.encode()).hexdigest()[:10], "name": display_name(latest["title"]),
                "category": latest.get("category", ""), "district": latest.get("district", ""),
                "place": latest.get("place", ""), "link": latest.get("link", ""),
                "multi": any(len(v) > 1 for v in by_year.values()),
                "lunar": bool(LUNAR.search(latest["title"])),
                "history": [{"y": y, "start": v[0]["start"], "end": v[0]["end"]} for y, v in sorted(by_year.items()) if y < target]}
        if target in by_year:
            e = by_year[target][0]
            out.append({**base, "status": "confirmed", "confidence": "confirmed",
                        "month": int(e["start"][5:7]), "part": part_of_month(int(e["start"][8:10])),
                        "start": e["start"], "end": e["end"]})
            continue
        if len(past) < 2 or max(past) < target - 2:
            continue
        recent = [past[y] for y in sorted(past)[-3:]]
        days = [doy(e["start"]) for e in recent]
        if max(days) - min(days) > 180:   # 12월↔1월 걸침
            days = [d + 365 if d < 180 else d for d in days]
        spread = max(days) - min(days)
        mid = int(median(days)) % 365 or 365
        d = date(2001, 1, 1) + timedelta(days=mid - 1)
        conf = "high" if len(past) >= 3 and spread <= 21 else "medium" if spread <= 35 else "low"
        dur = int(median((date.fromisoformat(e["end"]) - date.fromisoformat(e["start"])).days + 1 for e in recent))
        out.append({**base, "status": "forecast", "confidence": conf, "month": d.month, "part": part_of_month(d.day),
                    "spread_days": spread, "duration_days": dur, "years": len(past)})
    rank = {"confirmed": 0, "high": 1, "medium": 2, "low": 3}
    out.sort(key=lambda x: (x["month"], ["early", "mid", "late"].index(x["part"]), rank[x["confidence"]], x["name"]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=datetime.now(KST).year + 1)
    args = ap.parse_args()
    if not 2000 <= args.year <= 2100:
        return 2
    hist = json.loads(HISTORY_PATH.read_text("utf-8"))
    items = forecast(hist.get("festivals", {}), args.year)
    out = DATA / f"calendar_{args.year}.json"
    counts = {c: sum(1 for i in items if i["confidence"] == c) for c in ("confirmed", "high", "medium", "low")}
    payload = {"year": args.year, "generatedAt": datetime.now(KST).isoformat(timespec="seconds"),
               "historyUpdatedAt": hist.get("updatedAt", ""), "historyCount": len(hist.get("festivals", {})),
               "counts": counts, "items": items}
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "utf-8")
    tmp.replace(out)
    print(f"calendar {args.year}: {len(items)} items {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
