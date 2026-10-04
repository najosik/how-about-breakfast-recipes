#!/usr/bin/env python3
"""1회 조회: 문화행사 API(culturalEventInfo)에 지난 연도 행사가 얼마나 남아 있는지 통계만 출력.

내년도 축제 캘린더(예상 일정) 가능성 판단용. 데이터 파일은 저장하지 않고,
실행 로그와 GitHub Actions 요약(GITHUB_STEP_SUMMARY)에 집계만 남긴다.
- API 키는 환경변수 SEOUL_API_KEY로만 받고 어떤 출력에도 넣지 않는다(fetch_events와 동일).
- 원문(행사명)은 정제 후 출력: 줄바꿈·마크다운 표 구분자 제거, 워크플로 명령(::) 무력화.
"""
from __future__ import annotations

import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_events as fe  # noqa: E402

TOP_RECURRING = 40
# 연도·회차 표기 제거 → 같은 축제를 해마다 묶기 위한 키
YEAR_RE = re.compile(r"(19|20)\d{2}\s*년?|제?\s*\d{1,3}\s*회|\d{1,3}(st|nd|rd|th)\b", re.I)
NON_WORD = re.compile(r"[^0-9a-z가-힣]+", re.I)


def safe(text: object, limit: int = 60) -> str:
    s = fe.clean_text(text, limit)
    s = s.replace("|", "/").replace("`", "'").replace("::", ": :")
    return s


def title_key(title: str) -> str:
    return NON_WORD.sub("", YEAR_RE.sub("", title.lower()))


def summarize(rows: list[dict]) -> dict:
    by_year, fest_by_year, reg_by_year = Counter(), Counter(), Counter()
    groups: dict[str, dict] = defaultdict(lambda: {"title": "", "cat": "", "dates": {}})
    starts = []
    for r in rows:
        start = fe.parse_date(r.get("STRTDATE"))
        if not start:
            continue
        year = start[:4]
        starts.append(start)
        by_year[year] += 1
        reg = fe.parse_date(r.get("RGSTDATE"))
        if reg:
            reg_by_year[reg[:4]] += 1
        cat = fe.clean_text(r.get("CODENAME"), 40)
        if not cat.startswith("축제"):
            continue
        fest_by_year[year] += 1
        title = fe.clean_text(r.get("TITLE"), 200)
        key = title_key(title)
        if len(key) < 2:
            continue
        g = groups[key]
        g["title"] = g["title"] or title
        g["cat"] = g["cat"] or cat
        end = fe.parse_date(r.get("END_DATE")) or start
        g["dates"].setdefault(year, (start, end))
    recurring = sorted(
        ({"title": g["title"], "cat": g["cat"], "dates": dict(sorted(g["dates"].items()))}
         for g in groups.values() if len(g["dates"]) >= 2),
        key=lambda x: (-len(x["dates"]), x["title"]))
    return {
        "rows": len(rows),
        "earliest": min(starts) if starts else "",
        "latest": max(starts) if starts else "",
        "by_year": dict(sorted(by_year.items())),
        "festivals_by_year": dict(sorted(fest_by_year.items())),
        "registered_by_year": dict(sorted(reg_by_year.items())),
        "festival_titles": len(groups),
        "recurring_count": len(recurring),
        "recurring": recurring[:TOP_RECURRING],
    }


def to_markdown(total: int, s: dict, now: str) -> str:
    years = sorted(set(s["by_year"]) | set(s["festivals_by_year"]) | set(s["registered_by_year"]))
    out = [
        "## 문화행사 API 과거 데이터 조회 (1회)",
        f"- 조회 시각: {now} (KST)",
        f"- API 전체 건수(list_total_count): **{total:,}**, 읽은 건수: {s['rows']:,}",
        f"- 시작일 범위: {s['earliest'] or '-'} ~ {s['latest'] or '-'}",
        f"- 축제 고유 제목 {s['festival_titles']:,}개 중 **2개 연도 이상 반복 {s['recurring_count']:,}개**",
        "",
        "### 연도별 건수",
        "| 연도 | 전체(시작일 기준) | 축제 | 등록일 기준 |",
        "|---|---:|---:|---:|",
        *(f"| {y} | {s['by_year'].get(y, 0):,} | {s['festivals_by_year'].get(y, 0):,} | {s['registered_by_year'].get(y, 0):,} |" for y in years),
        "",
        f"### 해마다 반복되는 축제 (상위 {TOP_RECURRING})",
        "| 축제 | 분류 | 연도별 기간 |",
        "|---|---|---|",
    ]
    for r in s["recurring"]:
        dates = ", ".join(f"{y}: {a[5:]}~{b[5:]}" for y, (a, b) in r["dates"].items())
        out.append(f"| {safe(r['title'])} | {safe(r['cat'], 20)} | {dates} |")
    if not s["recurring"]:
        out.append("| (없음) | | |")
    return "\n".join(out) + "\n"


def main() -> int:
    key = os.environ.get("SEOUL_API_KEY", "").strip()
    if not fe.KEY_RE.match(key):
        print("SEOUL_API_KEY is missing or malformed.", file=sys.stderr)
        return 2
    try:
        total, rows = fe.extract(fe.fetch_page(key, 1, fe.PAGE_SIZE))
        pages = min(fe.MAX_PAGES, (total + fe.PAGE_SIZE - 1) // fe.PAGE_SIZE)
        for page in range(2, pages + 1):
            s = (page - 1) * fe.PAGE_SIZE + 1
            rows += fe.extract(fe.fetch_page(key, s, s + fe.PAGE_SIZE - 1))[1]
    except fe.FetchError as e:
        print(f"Fetch failed: {e}", file=sys.stderr)
        return 1
    now = datetime.now(fe.KST).strftime("%Y-%m-%d %H:%M")
    md = to_markdown(total, summarize(rows), now)
    for line in md.splitlines():
        print("  " + line)   # 줄 앞 공백: 원문이 워크플로 명령으로 해석되지 않게
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
