#!/usr/bin/env python3
"""한국관광공사 TourAPI(v2) 서울 음식점 목록 → data/tour_food.json (하루 1회)

- 언어별 서비스(KorService2·EngService2 …)에서 areaBasedList2로 서울(areaCode=1) 음식점만 수집
  음식점 contentTypeId: 국문 39 / 외국어 82 (concierge/src/config/tourapi.json)
- serviceKey는 환경변수 TOURAPI_KEY(Decoding 키). urlencode가 한 번만 인코딩한다(이중 인코딩 금지)
- https만 사용. JSON이 아닌 응답(XML 오류 등)은 오류로 처리하고 원문을 출력하지 않는다
- 원문은 데이터로만 다룬다: HTML 태그 제거·엔티티 해제·길이 제한만 하고 내용은 바꾸지 않는다
- 이미지는 공공누리 유형(cpyrhtDivCd)이 Type1/Type3인 경우만 남기고 유형을 함께 저장(Type3는 가공 금지)
- 상세(detailIntro2)는 수집하지 않는다: 질의 시 Worker가 조회
- 실패한 언어는 기존 파일의 해당 언어 목록을 유지한다(빈 결과로 덮어쓰지 않음)
"""
from __future__ import annotations

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
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "concierge" / "src" / "config" / "tourapi.json").read_text("utf-8"))
OUT_PATH = ROOT / "data" / "tour_food.json"
KST = timezone(timedelta(hours=9))
PAGE_SIZE = 1000
MAX_PAGES = 20
TIMEOUT = 30
MAX_BYTES = 20 * 1024 * 1024
KEY_RE = re.compile(r"^[A-Za-z0-9+/=]{20,200}$")   # Decoding 키(%가 있으면 Encoding 키 → 이중 인코딩)
TAG_RE = re.compile(r"<[^>]*>")
WS_RE = re.compile(r"\s+")

# 서울(areaCode=1) 시군구 코드 → 자치구
SIGUNGU = {1: "강남구", 2: "강동구", 3: "강북구", 4: "강서구", 5: "관악구", 6: "광진구", 7: "구로구", 8: "금천구",
           9: "노원구", 10: "도봉구", 11: "동대문구", 12: "동작구", 13: "마포구", 14: "서대문구", 15: "서초구",
           16: "성동구", 17: "성북구", 18: "송파구", 19: "양천구", 20: "영등포구", 21: "용산구", 22: "은평구",
           23: "종로구", 24: "중구", 25: "중랑구"}
GU_KO = set(SIGUNGU.values())
GU_EN = {"gangnam": "강남구", "gangdong": "강동구", "gangbuk": "강북구", "gangseo": "강서구", "gwanak": "관악구",
         "gwangjin": "광진구", "guro": "구로구", "geumcheon": "금천구", "nowon": "노원구", "dobong": "도봉구",
         "dongdaemun": "동대문구", "dongjak": "동작구", "mapo": "마포구", "seodaemun": "서대문구", "seocho": "서초구",
         "seongdong": "성동구", "seongbuk": "성북구", "songpa": "송파구", "yangcheon": "양천구",
         "yeongdeungpo": "영등포구", "yongsan": "용산구", "eunpyeong": "은평구", "jongno": "종로구", "jung": "중구",
         "jungnang": "중랑구"}
# 음식 분류(cat3) → 태그
FOOD_TYPE = {"A05020100": "korean", "A05020200": "western", "A05020300": "japanese", "A05020400": "chinese",
             "A05020700": "fusion", "A05020900": "cafe"}


class FetchError(Exception):
    """API 키·응답 원문을 포함하지 않는 오류."""


def clean_text(value: object, limit: int) -> str:
    s = TAG_RE.sub(" ", str(value or ""))
    s = WS_RE.sub(" ", html.unescape(s)).strip()
    return s[:limit]


def https_url(value: object) -> str:
    u = str(value or "").strip()
    if u.startswith("http://"):
        u = "https://" + u[len("http://"):]
    p = urllib.parse.urlparse(u)
    return u if p.scheme == "https" and p.netloc and len(u) <= 500 else ""


def district_of(item: dict) -> str:
    try:
        gu = SIGUNGU.get(int(item.get("sigungucode") or 0), "")
    except (TypeError, ValueError):
        gu = ""
    if gu:
        return gu
    addr = str(item.get("addr1") or "")
    for word in re.findall(r"[가-힣]{1,4}구", addr):
        if word in GU_KO:
            return word
    m = re.search(r"\b([A-Za-z]+)-gu\b", addr)
    return GU_EN.get(m.group(1).lower(), "") if m else ""


def coord(value: object, lo: float, hi: float) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return round(f, 6) if lo <= f <= hi else None


def normalize(item: dict, lang: str) -> dict | None:
    cid = str(item.get("contentid") or "").strip()
    title = clean_text(item.get("title"), 120)
    if not re.fullmatch(r"\d{1,12}", cid) or not title:
        return None
    lat, lng = coord(item.get("mapy"), 37.4, 37.75), coord(item.get("mapx"), 126.7, 127.25)
    lic = str(item.get("cpyrhtDivCd") or "").strip()
    image = https_url(item.get("firstimage")) if lic in ("Type1", "Type3") else ""
    return {
        "id": cid, "lang": lang, "title": title,
        "addr": clean_text(f"{item.get('addr1') or ''} {item.get('addr2') or ''}", 200),
        "district": district_of(item),
        "lat": lat, "lng": lng,
        "food_type": FOOD_TYPE.get(str(item.get("cat3") or ""), ""),
        "image": image, "image_license": lic if image else "",
        "modified": clean_text(item.get("modifiedtime"), 14),
    }


def fetch_page(lang: str, key: str, page: int, opener=urllib.request.urlopen) -> tuple[int, list[dict]]:
    svc = CONFIG["services"][lang]
    params = {"serviceKey": key, "MobileOS": "ETC", "MobileApp": CONFIG["mobile_app"], "_type": "json",
              "areaCode": CONFIG["area_code"], "contentTypeId": svc["food_content_type"],
              "numOfRows": PAGE_SIZE, "pageNo": page}
    url = f"{CONFIG['base_url']}/{svc['service']}/areaBasedList2?{urllib.parse.urlencode(params)}"
    if not url.startswith("https://"):
        raise FetchError("https only")
    req = urllib.request.Request(url, headers={"User-Agent": "seoul-now-tourapi/1.0", "Accept": "application/json"})
    last = "unknown"
    for attempt in range(3):
        try:
            with opener(req, timeout=TIMEOUT) as resp:
                body = resp.read(MAX_BYTES)
            return parse(body)
        except FetchError:
            raise
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
        except urllib.error.URLError as e:
            last = f"network error ({type(e.reason).__name__})"
        except TimeoutError:
            last = "timeout"
        time.sleep(2 ** (attempt + 1))
    raise FetchError(f"{lang} page {page}: {last}")   # URL(=키 포함)은 넣지 않는다


def parse(body: bytes) -> tuple[int, list[dict]]:
    text = body.decode("utf-8", errors="replace").lstrip()
    if not text.startswith("{"):
        raise FetchError("non-JSON response (XML error or wrong _type)")   # 원문 미노출
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise FetchError("invalid JSON response") from None
    resp = data.get("response") if isinstance(data, dict) else None
    if not isinstance(resp, dict):
        raise FetchError("unexpected response shape")
    code = str((resp.get("header") or {}).get("resultCode") or "")
    if code != "0000":
        raise FetchError(f"API result code {clean_text(code, 10) or 'missing'}")
    body_ = resp.get("body") or {}
    items = (body_.get("items") or {}) if isinstance(body_.get("items"), dict) else {}
    rows = items.get("item") or []
    if isinstance(rows, dict):
        rows = [rows]
    try:
        total = int(body_.get("totalCount") or 0)
    except (TypeError, ValueError):
        total = 0
    return total, [r for r in rows if isinstance(r, dict)]


def collect(lang: str, key: str, opener=urllib.request.urlopen) -> list[dict]:
    total, rows = fetch_page(lang, key, 1, opener)
    pages = min(MAX_PAGES, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    for page in range(2, pages + 1):
        rows += fetch_page(lang, key, page, opener)[1]
    seen, out = set(), []
    for r in rows:
        n = normalize(r, lang)
        if n and n["id"] not in seen:
            seen.add(n["id"])
            out.append(n)
    return out


def write_atomic(path: Path, data: dict) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tour-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main() -> int:
    key = os.environ.get("TOURAPI_KEY", "").strip()
    if not KEY_RE.match(key):
        hint = " (looks like the Encoding key; register the Decoding key)" if "%" in key else ""
        print(f"TOURAPI_KEY is missing or malformed{hint}.", file=sys.stderr)
        return 2
    existing = {}
    if OUT_PATH.exists():
        try:
            existing = json.loads(OUT_PATH.read_text("utf-8")).get("languages", {})
        except (OSError, json.JSONDecodeError):
            existing = {}
    now = datetime.now(KST).isoformat(timespec="seconds")
    langs, failed = {}, []
    for lang in CONFIG["services"]:
        try:
            items = collect(lang, key)
            if not items:
                raise FetchError("empty result")
            langs[lang] = {"updatedAt": now, "count": len(items), "items": items}
        except FetchError as e:
            failed.append(lang)
            print(f"{lang}: {e} - keeping previous data", file=sys.stderr)
            if lang in existing:
                langs[lang] = existing[lang]
    if not langs:
        return 1
    write_atomic(OUT_PATH, {"source": CONFIG["source_label"], "updatedAt": now, "languages": langs})
    print("tour_food: " + ", ".join(f"{k} {v['count']}" for k, v in langs.items()) + (f" (failed: {', '.join(failed)})" if failed else ""))
    if failed:
        print(f"::warning::TourAPI failed for {', '.join(failed)}; previous data kept.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
