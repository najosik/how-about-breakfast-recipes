# Seoul Now (프론트엔드)

`how-about-breakfast.com/seoulnow/` — 「Seoul Now 리뉴얼 웹 스타일 가이드」(2026-11-10) 1차 구현.
데이터는 기존 `/seoul-now/`(백엔드)가 6시간마다 수집하는 `../seoul-now/data/events.json`, `festival_tags.json`을 읽기만 한다.

## 파일
| 파일 | 역할 |
|---|---|
| `index.html` | 화면 골격, CSP(동의 후 Google 번역만 허용, 인라인 스크립트는 해시 1개) |
| `app.css` | 디자인 토큰(색·글꼴·간격·라운드·그림자·모션, 라이트/다크) |
| `lib.js` | 순수 로직: 기간(오늘·주말·이번 달), 12개월, 필터·정렬, 상태 배지, 날짜 표기, 주소 검증, .ics |
| `app.js` | 목록·월 패널·자치구 시트·장르 칩·결과 줄·상세·공유·상태 화면·주소 동기화 |
| `translate.js` | 번역 사전 고지 → 동의 시에만 Google 스크립트 로드, sessionStorage 동의, 원문 보기 |
| `i18n.js` | 한국어·영어 화면 문구 |
| `fonts/pretendard/` | Pretendard 1.3.9 가변 글꼴 동적 서브셋(자체 호스팅, OFL) |

## 테스트
`node --test seoulnow/tests` (기간·월·주소 검증·필터·정렬·배지·날짜 표기·.ics)

## 1차 범위 밖(2차)
- 목록과 필터를 공유하는 캘린더 보기(`?view=calendar`), 축제 캘린더 예상/확정 구분 막대
- 행사별 og 태그: 정적 호스팅이라 서버 생성 불가 → 상세 공유 미리보기는 사이트 공통 정보로 표시
- 응답 헤더(HSTS·nosniff·frame-ancestors): GitHub Pages는 헤더를 직접 설정할 수 없음. CSP·Referrer는 meta로 적용
- 인기순 정렬은 가이드대로 도입하지 않음
