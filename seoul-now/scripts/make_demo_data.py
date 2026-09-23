#!/usr/bin/env python3
"""로컬 미리보기용 '예시' 데이터를 만듭니다. 실제 행사가 아닙니다.

실제 데이터는 fetch_events.py(GitHub Actions)가 같은 경로에 덮어씁니다.
"""
import random
from datetime import datetime, timedelta

import fetch_events as fe

CATS = ["콘서트", "클래식", "국악", "연극", "뮤지컬/오페라", "무용", "전시/미술", "영화",
        "교육/체험", "축제-문화/예술", "축제-전통/역사", "축제-자연/경관", "기타"]
GUS = ["종로구", "중구", "용산구", "마포구", "강남구", "송파구", "성동구", "서초구", "영등포구", "서대문구"]


def main():
    rng = random.Random(42)
    today = datetime.now(fe.KST).date()
    rows = []
    for i in range(60):
        start = today + timedelta(days=rng.randint(-20, 40))
        end = start + timedelta(days=rng.choice([0, 0, 1, 2, 6, 13, 30, 60]))
        cat, gu = rng.choice(CATS), rng.choice(GUS)
        free = rng.random() < 0.45
        rows.append({
            "TITLE": f"[예시] {gu} {cat} 행사 {i + 1}",
            "CODENAME": cat, "GUNAME": gu,
            "STRTDATE": f"{start} 00:00:00.0", "END_DATE": f"{end} 00:00:00.0",
            "DATE": f"{start}~{end}",
            "PLACE": f"{gu} 예시 문화공간", "ORG_NAME": "예시 주최기관",
            "USE_TRGT": "누구나", "USE_FEE": "" if free else "전석 20,000원",
            "IS_FREE": "무료" if free else "유료",
            "PROGRAM": "로컬 미리보기를 위한 예시 설명입니다. 실제 행사 정보가 아닙니다.",
            "ORG_LINK": "https://culture.seoul.go.kr/",
        })
    events = [e for e in map(fe.normalize, rows) if e and e["end"] >= today.isoformat()]
    events.sort(key=lambda e: (e["end"], e["start"]))
    fe.write_atomic(fe.OUT_PATH, {
        "updatedAt": datetime.now(fe.KST).isoformat(timespec="seconds"),
        "source": "DEMO DATA - not real events",
        "demo": True,
        "count": len(events),
        "events": events,
    })
    print(f"Wrote {len(events)} demo events to {fe.OUT_PATH}")


if __name__ == "__main__":
    main()
