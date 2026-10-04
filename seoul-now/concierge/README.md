# 서울 AI 관광 컨시어지 — 내부 시연용 프로토타입

> ⚠️ **서울관광재단 내부 시연용입니다. 실제 결제·예약은 이루어지지 않으며, 실제 개인정보를 다루지 않습니다.**
> 장소·교통·패스·관광정보센터 정보는 **샘플 데이터**입니다. 운영시간·가격 등은 실제와 다를 수 있습니다.
> 축제 정보만 실데이터(서울시 문화행사 정보 API)입니다.

교통·음식·쇼핑·축제를 한 번에 답하는 다국어(ko/en/ja/zh-CN/zh-TW) 관광 안내 엔진의 시연판입니다.
향후 OK-Seoul·비짓서울·관광정보센터에 공통으로 붙는 "안내 엔진"을 가정합니다. 설계 기준은 `CLAUDE.md`(별도 제공)입니다.

## 구성
```
[브라우저: 채팅 화면]  ── 같은 Worker가 화면과 API를 함께 제공 (Cloudflare Access로 직원 전용)
      │ POST /api/chat (메시지만, 키 없음)
      ▼
[Cloudflare Worker]  입력 검증 · 개인정보 마스킹 · 레이트리밋 · 안전 로그 · 출력 필터
      │ Claude API (공식 SDK, tool use, 요청당 도구 5회 상한)
      ▼
 search_festivals  → 기존 축제 모듈(seoul-now/scripts/fetch_events.py)이 만드는 events.json 어댑터 (실데이터)
 search_places     → rankPlaces() — 추천 순위는 코드가 결정(config/ranking.json)
 get_transit_guide / recommend_dsp / find_info_center → 샘플 데이터
```

| 경로 | 내용 |
|---|---|
| `src/worker.js` | Worker 본체: `/api/chat`, `/api/dsp/<id>`(목업 결제용 상품 1건), 정적 화면 |
| `src/festivals.js` | 기존 축제 모듈 어댑터(모듈은 수정하지 않음) |
| `src/places.js` | `rankPlaces()` · `search_places` |
| `src/tools.js` | 도구 정의·실행, 화면 카드 생성(카드는 LLM이 아니라 코드가 만든다) |
| `src/security.js` | 입력 검증, 마스킹, 인젝션 탐지, 출력 필터, 레이트리밋, 로그 |
| `src/prompt.js` | 시스템 프롬프트(응답 규칙) |
| `src/data/*.json` | 샘플 데이터(모두 `is_sample: true`) |
| `src/config/ranking.json` | 추천 가중치 — 비개발자 조정용 |
| `public/` | 채팅 화면, 목업 결제 화면 |
| `dev/` | 로컬 개발 서버, 모의 모델, 시나리오 점검 스크립트(배포에 포함되지 않음) |
| `TEST_REPORT.md` | 시나리오·보안 점검 결과 |

## 로컬에서 실행
Node 20 이상이 필요합니다.
```bash
cd seoul-now/concierge
npm ci
npm test          # 단위 테스트
npm run dev       # http://localhost:8787
```
- `ANTHROPIC_API_KEY`가 없으면 **모의 모델**로 동작합니다. 답변 앞에 `[개발용 모의 응답]`이 붙으며, 화면·흐름 확인용입니다.
- 실제 Claude로 실행하려면 키를 **환경변수로만** 넘기세요. 파일·코드에 적지 마세요.
  ```bash
  ANTHROPIC_API_KEY=... npm run dev
  ```

### 시나리오 점검 (§3 · §13)
```bash
node dev/scenarios.mjs                                       # 모의 모델
ANTHROPIC_API_KEY=... node dev/scenarios.mjs                 # 실제 Claude (약 10회 호출, 비용 발생)
ANTHROPIC_API_KEY=... SHOW_REPLIES=1 node dev/scenarios.mjs  # 답변 원문도 출력
```

## 배포 (Cloudflare Worker)
1. **번들 만들기:** `npm run build`를 실행하면 `dist/concierge-worker.js`(단일 파일, 화면·샘플 데이터·SDK 포함)가 생깁니다.
2. **Worker 만들기:** Cloudflare 대시보드 → Workers & Pages → Create → Worker를 만들고 코드 편집기에 `dist/concierge-worker.js` 내용을 붙여 넣은 뒤 Deploy합니다.
3. **설정** (Worker → Settings)

   | 종류 | 이름 | 값 |
   |---|---|---|
   | Secret | `ANTHROPIC_API_KEY` | Claude API 키 (채팅·코드·저장소에 남기지 않기) |
   | KV 바인딩 | `RATE_KV` | 새 KV 네임스페이스 (레이트리밋용, 2분 뒤 자동 삭제) |
   | Variable (선택) | `CLAUDE_MODEL` | 기본 `claude-sonnet-5-5` |
   | Variable (선택) | `EVENTS_URL` | 기본 `https://how-about-breakfast.com/seoul-now/data/events.json` |
   | Variable (선택) | `RL_SALT` | 임의 문자열 (레이트리밋 해시용) |
   | Variable (선택) | `ALLOWED_ORIGIN` | 다른 도메인에서 API를 부를 때만 |

4. **직원 전용으로 제한 (필수 권장):** Zero Trust → Access → Applications → Add → Self-hosted를 선택하고 Worker 도메인을 지정합니다. 정책은 Allow, 조건은 `Emails ending in @sto.or.kr`(또는 시연 참가자 이메일 목록)로 둡니다. 화면과 API가 같은 도메인이라 한 번에 보호됩니다.
5. **확인:** Worker 주소로 접속해 시연 시나리오 버튼 4개를 눌러 봅니다. 위 시나리오 점검 스크립트를 실제 키로 한 번 실행합니다.

> `CLAUDE_MODEL`을 바꿀 때 주의: 언어 지시를 대화 중간 system 메시지로 보내므로, 이를 지원하는 모델(Claude Sonnet 5.5, Opus 5.5 등)을 쓰세요.
> 요청은 서버측 거절 대체(`fallbacks: "default"`)를 사용합니다. 모델이 안전 정책으로 거절하면 API가 권장 모델로 자동 재시도합니다.

## 추천 가중치 조정 (`src/config/ranking.json`)
- **가중치(`weights`):** 전통시장 +0.20, 로컬 상권 +0.15, 야간(18시 이후) +0.15, 대형몰·면세점 −0.10. 값은 −1~1 범위이며, 벗어나면 기본값을 씁니다.
- **`max_related_in_top`:** 요청과 다른 관련 카테고리(예: 쇼핑 질의에 대한 전통시장)가 상위 5개에 들어갈 수 있는 최대 개수입니다. 기본 2입니다.
- **로컬 상권 보장:** 상위 5개에 전통시장·로컬 상권이 하나도 없으면 5번째를 교체해 1개 이상 들어가게 합니다.
- **반영 방법:** 값을 수정한 뒤 `npm test && npm run build`를 실행하고 다시 배포합니다.

## 보안·개인정보 요약 (상세: `TEST_REPORT.md`)
- **최소수집:**
  - 이름·연락처·여권번호·정확한 위치를 받지 않습니다. 화면에 위치 권한 자체를 막아 두었습니다(`Permissions-Policy`).
  - 입력에 개인정보가 섞여 있으면 마스킹한 뒤 Claude에 전달합니다.
- **저장하지 않음:**
  - 대화는 브라우저 메모리에만 있습니다.
  - 서버 로그에는 길이·언어·도구명·이벤트만 남습니다.
  - 레이트리밋 키는 해시이며 2분 뒤 삭제됩니다.
- **OWASP Top 10:**
  - 출력: LLM 출력을 HTML로 렌더링하지 않습니다.
  - 헤더: CSP와 보안 헤더를 적용하고 상세 오류는 숨깁니다.
  - 제한: 입력 1,000자, 분당 10회.
  - 경로: 관리용 엔드포인트가 없고, 샘플 데이터는 공개 경로에 두지 않습니다.
  - 의존성: `npm audit` 결과 high 이상 0건.
- **OWASP LLM Top 10:**
  - 도구 결과를 지시가 아닌 데이터로 취급합니다(인젝션 방어).
  - 출력 필터로 시스템 프롬프트·키 유출을 차단합니다.
  - 도구는 읽기 전용이고, 결제는 목업 화면 링크만 반환합니다.
  - 출처 배지를 붙이고, 카드는 코드가 만듭니다.
  - 도구 호출 5회, `max_tokens` 2,000 상한을 둡니다.

## 알려진 제약
- 장소·교통·패스·센터 정보는 샘플입니다. 비짓서울 실 API 연동은 2단계 과제입니다.
- 축제 원천 데이터는 한국어만 있어 외국어 화면에서도 축제명이 한국어로 나옵니다.
- 동북권(성동·광진 등)에는 실재가 확인된 관광정보센터 샘플이 없어 인접 권역 센터를 안내합니다.
- KV 레이트리밋은 근사치입니다(KV에 원자적 증가가 없음). 시연 규모에는 충분합니다.
