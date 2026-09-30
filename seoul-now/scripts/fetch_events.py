#!/usr/bin/env python3
"""서울시 문화행사 정보(culturalEventInfo) API → data/events.json

GitHub Actions에서 주기적으로 실행합니다. API 키는 환경변수 SEOUL_API_KEY로만
받으며, 브라우저로 전달되는 파일에는 절대 포함하지 않습니다.

- 표준 라이브러리만 사용 (서드파티 의존성 없음 → 공급망 위험 최소화)
- 모든 외부 값은 정제(태그 제거, 길이 제한, URL 스킴 화이트리스트) 후 저장
- 수집 실패 시 기존 파일을 덮어쓰지 않음(원자적 쓰기)
"""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# 서울 열린데이터광장 OpenAPI는 HTTP(8088)만 제공합니다.
API_BASE = "http://openapi.seoul.go.kr:8088"
SERVICE = "culturalEventInfo"
PAGE_SIZE = 1000          # API 1회 최대 호출 건수
MAX_PAGES = 30            # 비정상 응답으로 인한 무한 호출 방지
TIMEOUT = 30
KST = timezone(timedelta(hours=9))
LOOKAHEAD_DAYS = 120      # 오늘부터 이 기간 안에 시작하는 행사만 저장

OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "events.json"

KEY_RE = re.compile(r"^[A-Za-z0-9]{10,100}$")
TAG_RE = re.compile(r"<[^>]*>")
WS_RE = re.compile(r"\s+")

FIELD_LIMITS = {
    "title": 200, "category": 40, "district": 20, "place": 200, "org": 200,
    "target": 300, "fee": 300, "player": 500, "program": 1000, "etc": 1000,
    "theme": 100,
}


class FetchError(Exception):
    """API 키 등 민감정보를 포함하지 않는 오류."""


def clean_text(value: object, limit: int) -> str:
    if value is None:
        return ""
    text = html.unescape(str(value))
    text = TAG_RE.sub(" ", text)
    text = WS_RE.sub(" ", text).strip()
    return text[:limit]


def clean_url(value: object, *, force_https: bool = False) -> str:
    """http/https 절대 URL만 허용. javascript:, data: 등은 버림."""
    if not value:
        return ""
    raw = str(value).strip()
    try:
        parts = urllib.parse.urlsplit(raw)
    except ValueError:
        return ""
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        return ""
    if len(raw) > 1000:
        return ""
    if force_https and parts.scheme.lower() == "http":
        parts = parts._replace(scheme="https")
    return urllib.parse.urlunsplit(parts)


def parse_date(value: object) -> str:
    """'2026-09-23 00:00:00.0' → '2026-09-23'. 형식이 다르면 빈 문자열."""
    s = str(value or "").strip()[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date().isoformat()
    except ValueError:
        return ""


def parse_coord(value: object, lo: float, hi: float) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return round(f, 6) if lo <= f <= hi else None


def normalize(row: dict) -> dict | None:
    title = clean_text(row.get("TITLE"), FIELD_LIMITS["title"])
    start = parse_date(row.get("STRTDATE"))
    end = parse_date(row.get("END_DATE")) or start
    if not title or not start:
        return None
    if end < start:
        end = start

    place = clean_text(row.get("PLACE"), FIELD_LIMITS["place"])
    # 원천 데이터에서 LAT/LOT 값이 뒤바뀌어 제공되는 경우가 있어 범위로 판별
    a = parse_coord(row.get("LAT"), -180, 180)
    b = parse_coord(row.get("LOT"), -180, 180)
    lat = lng = None
    for x, y in ((a, b), (b, a)):
        if x is not None and y is not None and 37.0 <= x <= 38.0 and 126.0 <= y <= 128.0:
            lat, lng = x, y
            break

    uid = hashlib.sha1(f"{title}|{start}|{place}".encode("utf-8")).hexdigest()[:12]
    is_free = str(row.get("IS_FREE") or "").strip() == "무료"

    return {
        "id": uid,
        "title": title,
        "category": clean_text(row.get("CODENAME"), FIELD_LIMITS["category"]),
        "district": clean_text(row.get("GUNAME"), FIELD_LIMITS["district"]),
        "start": start,
        "end": end,
        "dateText": clean_text(row.get("DATE"), 100),
        "place": place,
        "org": clean_text(row.get("ORG_NAME"), FIELD_LIMITS["org"]),
        "target": clean_text(row.get("USE_TRGT"), FIELD_LIMITS["target"]),
        "fee": clean_text(row.get("USE_FEE"), FIELD_LIMITS["fee"]),
        "free": is_free,
        "player": clean_text(row.get("PLAYER"), FIELD_LIMITS["player"]),
        "program": clean_text(row.get("PROGRAM"), FIELD_LIMITS["program"]),
        "etc": clean_text(row.get("ETC_DESC"), FIELD_LIMITS["etc"]),
        "theme": clean_text(row.get("THEMECODE"), FIELD_LIMITS["theme"]),
        "link": clean_url(row.get("ORG_LINK")),
        "homepage": clean_url(row.get("HMPG_ADDR")),
        "image": clean_url(row.get("MAIN_IMG"), force_https=True),
        "lat": lat,
        "lng": lng,
    }


def fetch_page(key: str, start: int, end: int) -> dict:
    url = f"{API_BASE}/{key}/json/{SERVICE}/{start}/{end}/"
    req = urllib.request.Request(url, headers={"User-Agent": "seoul-now-fetcher/1.0"})
    last_err = "unknown"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:  # noqa: S310 (고정 호스트)
                body = resp.read(20 * 1024 * 1024)  # 응답 크기 상한 20MB
            return json.loads(body.decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}"
        except urllib.error.URLError as e:
            last_err = f"network error ({type(e.reason).__name__})"
        except (json.JSONDecodeError, UnicodeDecodeError):
            last_err = "invalid JSON response"
        except TimeoutError:
            last_err = "timeout"
        time.sleep(2 ** (attempt + 1))
    # URL(=API 키 포함)은 절대 메시지에 넣지 않는다
    raise FetchError(f"rows {start}-{end}: {last_err}")


def extract(payload: dict) -> tuple[int, list[dict]]:
    body = payload.get(SERVICE)
    if not isinstance(body, dict):
        result = payload.get("RESULT") or {}
        code = clean_text(result.get("CODE"), 20) or "UNKNOWN"
        raise FetchError(f"API error code {code}")
    code = (body.get("RESULT") or {}).get("CODE", "")
    if code and code != "INFO-000":
        raise FetchError(f"API error code {clean_text(code, 20)}")
    total = int(body.get("list_total_count") or 0)
    rows = body.get("row") or []
    return total, [r for r in rows if isinstance(r, dict)]


def collect(key: str, today: date) -> list[dict]:
    horizon = (today + timedelta(days=LOOKAHEAD_DAYS)).isoformat()
    today_s = today.isoformat()
    events: dict[str, dict] = {}
    total, rows = extract(fetch_page(key, 1, PAGE_SIZE))
    pages = min(MAX_PAGES, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    for page in range(1, pages + 1):
        if page > 1:
            s = (page - 1) * PAGE_SIZE + 1
            _, rows = extract(fetch_page(key, s, s + PAGE_SIZE - 1))
            time.sleep(0.5)
        for row in rows:
            ev = normalize(row)
            if ev and ev["end"] >= today_s and ev["start"] <= horizon:
                events[ev["id"]] = ev
    return sorted(events.values(), key=lambda e: (e["end"], e["start"], e["title"]))


def write_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".events-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main() -> int:
    key = os.environ.get("SEOUL_API_KEY", "").strip()
    if not KEY_RE.match(key):
        print("SEOUL_API_KEY is missing or malformed.", file=sys.stderr)
        return 2
    now = datetime.now(KST)
    try:
        events = collect(key, now.date())
    except FetchError as e:
        print(f"Fetch failed: {e}", file=sys.stderr)
        return 1
    if not events:
        # 빈 결과로 기존 데이터를 지우지 않도록 중단
        print("No upcoming events returned; keeping existing data.", file=sys.stderr)
        return 1
    write_atomic(OUT_PATH, {
        "updatedAt": now.isoformat(timespec="seconds"),
        "source": "Seoul Open Data Plaza (data.seoul.go.kr) - culturalEventInfo",
        "demo": False,
        "count": len(events),
        "events": events,
    })
    print(f"Saved {len(events)} events.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
