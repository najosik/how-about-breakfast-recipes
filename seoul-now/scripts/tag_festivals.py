#!/usr/bin/env python3
"""축제·행사 외국인 적합도 태깅(festival_fit) — 수집 시 1회, 규칙 기반.

data/events.json(fetch_events.py 산출물) → data/festival_tags.json
- 이미 태그가 있는 행사는 다시 분류하지 않는다(질의 시 재분류 금지 · 결과 재현 가능).
  규칙을 바꿔 전체를 다시 태깅하려면 --retag.
- 원문은 데이터로만 다룬다: 정해진 패턴과 대조할 뿐, 원문 속 문장을 해석·실행하지 않는다(LLM01).
- 담당자 수정(pin/exclude)은 data/festival_overrides.json 에 두며, 이 스크립트는 건드리지 않는다.

태그
  language_barrier     low | mid | high   말을 몰라도 즐길 수 있는 정도
  nonverbal            bool               언어 없이 즐길 수 있는 형식(전시·빛·음식·연주 등)
  reservation_barrier  none | online | kr_auth_required
  audience_restricted  bool               거주자·재학생·회원·특정 계층 한정
  experience_type      traditional | kculture | food | light | performance | etc
  reason               1문장(한국어) — 판단 근거
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

RULES_VERSION = "2026-10-04.1"
KST = timezone(timedelta(hours=9))
DATA = Path(__file__).resolve().parent.parent / "data"
EVENTS_PATH = DATA / "events.json"
TAGS_PATH = DATA / "festival_tags.json"

# ---- 대상 제한(관광객이 참여하기 어려운 경우) ----
RESTRICT_ALWAYS = re.compile(r"주민|거주|재학생|재직자|직장인 대상|회원|등록자|수강생|자립준비|어르신|노인|65세 이상|장애인|임산부|다문화가정|보호자 동반 아동만")
RESIDENT = re.compile(r"[가-힣]{1,4}구민")
OPEN_SEOUL = re.compile(r"서울시민|누구나 참여|외국인")
# "수강생 및 교내외 누구나", "지역주민, 가족 단위 방문객, … 시민 누구나"처럼 한정 뒤에 '누구나'로 넓히는 경우
OPENED_UP = re.compile(r"(및|,|·)[^,]{0,30}누구나|방문객|관광객")
ONLY_CHILD = re.compile(r"^\s*(청소년|어린이|유아|아동|초등학생|중학생|고등학생)(\s*(만|대상|한정))?\s*$")

# ---- 예약 장벽 ----
KR_AUTH = re.compile(r"본인\s*인증|실명\s*인증|휴대(폰|전화)\s*인증|주민등록|아이핀|공공서비스\s*예약|yeyak\.seoul")
ONLINE = re.compile(r"예약|예매|사전\s*신청|신청\s*(필수|접수|후)|접수|선착순|추첨|티켓|인터파크|티켓링크|멜론티켓|nol\.|interpark|ticketlink", re.I)

# ---- 경험 유형 ----
KCULTURE = re.compile(r"k-?pop|케이팝|k-?culture|k-?wave|k-?dance|한류|아이돌|k-?드라마|k-?뷰티", re.I)
FOOD = re.compile(r"음식|푸드|먹거리|미식|맥주|비어|beer|옥토버페스트|oktoberfest|와인|막걸리|전통주|김장|떡|food|요리", re.I)
LIGHT = re.compile(r"빛|조명|라이트|light|불꽃|등\s*축제|연등|미디어\s*아트|일루미|야경|드론\s*쇼", re.I)
# 장소명(예: 덕수궁길)에 걸리지 않도록 제목·분류·프로그램에서만 찾는다
TRADITIONAL = re.compile(r"전통|국악|한옥|궁궐|고궁|경복궁|창덕궁|덕수궁|창경궁|경희궁|왕실|수문장|혼례|탈춤|사물놀이|판소리|민속|세시|단오|한복|무예|행궁")
PERFORMANCE_CAT = {"콘서트", "클래식", "국악", "독주/독창회", "연극", "뮤지컬/오페라", "무용"}

# ---- 언어 ----
SUBTITLE = re.compile(r"영어|english|외국어|자막|통역|다국어|global|foreigner", re.I)
VERBAL_CAT = {"연극", "뮤지컬/오페라", "교육/체험"}
VERBAL_WORD = re.compile(r"강연|강의|토크|북\s*토크|낭독|세미나|포럼|인문학|아카데미|교실|워크숍|해설|설명회|도서관|책|독서|작가|북\s*콘서트")
NONVERBAL_WORD = re.compile(r"넌버벌|non-?verbal|마임|서커스|퍼레이드|전시|미디어\s*아트|불꽃|무용|발레|댄스|dance|연주|오케스트라|음악|뮤직|music|마켓|장터|야시장|페어|fair|박람회|사일런트", re.I)


def _text(ev: dict, *keys: str) -> str:
    return " ".join(str(ev.get(k) or "") for k in keys)


def classify(ev: dict) -> dict:
    """행사 1건 → 태그. 정해진 패턴 대조만 수행(결정적)."""
    title, cat = str(ev.get("title") or ""), str(ev.get("category") or "")
    target = str(ev.get("target") or "")
    detail = _text(ev, "fee", "etc", "program", "target")
    everything = _text(ev, "title", "category", "theme", "place", "program", "etc", "player")
    core = _text(ev, "title", "category", "program")
    reasons = []

    # 대상 제한
    restricted = False
    if OPENED_UP.search(target):
        pass
    elif RESTRICT_ALWAYS.search(target) or ONLY_CHILD.match(target):
        restricted = True
        reasons.append(f"참여 대상이 '{target[:20]}'로 한정")
    elif RESIDENT.search(target) and not OPEN_SEOUL.search(target):
        restricted = True
        reasons.append(f"참여 대상이 '{target[:20]}'로 거주자 한정")

    # 예약
    if KR_AUTH.search(detail):
        reservation = "kr_auth_required"
        reasons.append("국내 본인인증이 필요한 예약")
    elif ONLINE.search(detail):
        reservation = "online"
        reasons.append("사전 예약·신청 필요")
    else:
        reservation = "none"

    # 경험 유형
    if KCULTURE.search(everything):
        exp = "kculture"
    elif TRADITIONAL.search(core) or cat in ("국악", "축제-전통/역사"):
        exp = "traditional"
    elif FOOD.search(title):
        exp = "food"
    elif LIGHT.search(title):
        exp = "light"
    elif cat in PERFORMANCE_CAT:
        exp = "performance"
    else:
        exp = "etc"

    # 비언어성·언어 장벽
    verbal = cat in VERBAL_CAT or bool(VERBAL_WORD.search(title))
    nonverbal = (not verbal) and (
        exp in ("food", "light", "kculture") or cat in ("전시/미술", "클래식", "무용", "국악", "독주/독창회")
        or bool(NONVERBAL_WORD.search(core)))
    if SUBTITLE.search(everything) or nonverbal:
        lang = "low"
    elif verbal:
        lang = "high"
    else:
        lang = "mid"

    if nonverbal:
        reasons.append("말을 몰라도 즐길 수 있는 형식")
    elif lang == "high":
        reasons.append("한국어 이해가 필요한 형식")
    if not reasons:
        reasons.append("특별한 참여 제약이 확인되지 않음")
    return {
        "language_barrier": lang,
        "nonverbal": nonverbal,
        "reservation_barrier": reservation,
        "audience_restricted": restricted,
        "experience_type": exp,
        "reason": ", ".join(reasons[:2]) + ".",
    }


def tag_all(events: list[dict], existing: dict, retag: bool = False, now: str = "") -> tuple[dict, int]:
    """새 행사만 태깅하고, 사라진 행사의 태그는 정리한다. (태그 사전, 새로 태깅한 수)"""
    out, new = {}, 0
    for ev in events:
        eid = str(ev.get("id") or "")
        if not re.fullmatch(r"[0-9a-f]{6,40}", eid):
            continue
        if not retag and eid in existing:
            out[eid] = existing[eid]
            continue
        out[eid] = {**classify(ev), "tagged_by": "rules", "rules_version": RULES_VERSION, "tagged_at": now}
        new += 1
    return out, new


def write_atomic(path: Path, data: dict) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tags-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--retag", action="store_true", help="규칙 변경 후 전체 다시 태깅")
    args = ap.parse_args()
    events = json.loads(EVENTS_PATH.read_text("utf-8")).get("events", [])
    existing = {}
    if TAGS_PATH.exists():
        try:
            existing = json.loads(TAGS_PATH.read_text("utf-8")).get("tags", {})
        except (OSError, json.JSONDecodeError):
            existing = {}
    now = datetime.now(KST).isoformat(timespec="seconds")
    tags, new = tag_all(events, existing, args.retag, now)
    write_atomic(TAGS_PATH, {"rules_version": RULES_VERSION, "updatedAt": now, "count": len(tags), "tags": tags})
    print(f"tagged {new} new / {len(tags)} total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
