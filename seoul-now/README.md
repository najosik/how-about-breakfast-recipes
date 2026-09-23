# What's On in Seoul · 서울에서 지금 뭐하지

서울시 문화행사 정보 API(서울 열린데이터광장 `culturalEventInfo`)로 외국인 관광객에게
"지금 서울에서 볼 만한 공연·전시·축제"를 보여주는 정적 웹사이트입니다.
서버·데이터베이스가 없고, 쿠키나 분석 도구도 쓰지 않습니다.

## 기능 (MVP)
- 기간 필터: 오늘 / 이번 주말 / 7일 이내 / 30일 이내 / 전체 (한국 시간 기준)
- 분류 필터(공연·전시·축제·영화·교육/체험·기타), 자치구 필터, 무료만 보기, 키워드 검색
- 종료 임박순 / 시작일순 정렬, "진행 중"·"오늘 종료" 배지
- 상세 팝업: 일정·장소·요금·대상, 공식 페이지(영문 자동번역 링크 포함), 구글·네이버 지도 링크
- 영어/한국어 UI 전환(브라우저 언어 자동 감지), 필터 상태를 URL에 저장해 공유 가능
- 라이트/다크 모드, 모바일 대응

행사 제목·설명은 서울시가 한국어로만 제공합니다. 분류·자치구명과 UI는 영어로 번역되어 있습니다.

## 구조
```
index.html            화면 뼈대 (CSP 메타 태그 포함)
styles.css            스타일
i18n.js               UI 문구 · 분류 · 25개 자치구 영문 사전
app.js                필터 · 렌더링 · 상세 팝업
data/events.json      사이트가 읽는 데이터 (Actions가 자동 갱신)
scripts/fetch_events.py      API 수집 · 정제 스크립트 (표준 라이브러리만 사용)
scripts/test_fetch_events.py 단위 테스트
scripts/make_demo_data.py    로컬 미리보기용 예시 데이터 생성
.github/workflows/fetch-events.yml  6시간마다 수집 후 커밋
```

## 로컬에서 보기
```bash
python3 scripts/make_demo_data.py   # 예시 데이터 생성 (실제 행사 아님, 화면에 안내 배너 표시)
python3 -m http.server 8000         # http://localhost:8000
```
실제 데이터로 확인하려면 API 키를 환경변수로 넘깁니다. 키를 코드나 파일에 적지 마세요.
```bash
SEOUL_API_KEY=발급받은키 python3 scripts/fetch_events.py
```
테스트: `python3 -m unittest discover -s scripts`

## 배포 (새 저장소 연결 후)
1. 이 폴더를 새 GitHub 저장소의 루트로 올립니다.
2. [서울 열린데이터광장](https://data.seoul.go.kr)에서 인증키를 발급받습니다.
3. 저장소 Settings → Secrets and variables → Actions에 `SEOUL_API_KEY`를 등록합니다.
4. Actions 탭에서 **Fetch Seoul culture events** 워크플로를 한 번 수동 실행합니다.
5. Settings → Pages에서 `main` 브랜치 루트를 배포 대상으로 설정합니다.

## 보안 설계 (OWASP Top 10 기준)
| 항목 | 적용 내용 |
|---|---|
| A01 접근 통제 | 쓰기 기능·관리자 기능 없음. 워크플로 권한은 `contents: write`만 부여 |
| A02 암호화 실패 | API 키는 GitHub Secret으로만 보관, 브라우저로 전달되는 파일에 포함하지 않음. 이미지 URL은 https로 올려서 저장 |
| A03 인젝션(XSS) | 외부 데이터는 수집 단계에서 태그 제거·길이 제한, 화면에서는 `textContent`로만 출력(`innerHTML` 미사용). 링크는 http/https만 허용해 `javascript:` URL 차단. URL 파라미터는 허용 목록으로 검증 |
| A04 안전하지 않은 설계 | 수집 실패나 0건 응답이면 기존 데이터를 유지하고, 파일은 원자적으로 교체 |
| A05 보안 설정 오류 | CSP로 외부·인라인 스크립트 차단, `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`. 외부 링크에 `rel="noopener noreferrer"` |
| A06 취약한 구성요소 | 프런트·수집 스크립트 모두 서드파티 라이브러리 없음. Actions는 커밋 SHA로 고정 |
| A07 인증 실패 | 로그인 기능 없음. API 키 형식을 검증 |
| A08 무결성 실패 | 수집 전에 단위 테스트를 실행하고, 수신 데이터 스키마를 검증(날짜 형식·필수 필드) |
| A09 로깅·모니터링 | 오류 메시지에 키가 포함된 요청 URL을 남기지 않음(테스트로 확인). Actions 실패 알림으로 감지 |
| A10 SSRF | 요청 대상 호스트가 코드에 고정되어 있고, 사용자 입력으로 URL을 만들지 않음 |

**개인정보**: 개인정보를 수집·저장하지 않으며 쿠키·로컬스토리지·분석 도구를 사용하지 않습니다(개인정보 보호법상 처리방침 대상 없음). 지도나 번역 서비스는 사용자가 링크를 누를 때만 외부로 이동합니다.

**알려진 제약**
- 서울 열린데이터광장 OpenAPI는 HTTP(8088)만 지원하므로, 수집 요청의 API 키가 평문으로 전송됩니다. 이 요청은 GitHub Actions 서버에서만 나가고 사용자 브라우저에서는 나가지 않습니다. 이 키는 해당 API 조회 용도로만 쓰세요.
- GitHub Pages에서는 응답 헤더를 설정할 수 없어 `frame-ancestors`, HSTS 등은 적용되지 않습니다. 필요하면 Cloudflare 같은 CDN을 앞에 두고 헤더를 추가하세요.

## 데이터 출처
서울 열린데이터광장, 「서울시 문화행사 정보」. 일정·요금은 바뀔 수 있으니 방문 전 공식 페이지를 확인하도록 안내합니다.
