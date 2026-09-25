# 인스타그램 인사이트 대시보드 (비공개)

본인만 보는 인스타그램 인사이트 대시보드입니다. 이 저장소와 사이트는 공개 상태이므로
**수집한 데이터는 저장소에 절대 올리지 않고**, 비공개 Cloudflare R2 버킷에만 저장합니다.

```
GitHub Actions (매일 06:30 KST)
  └ insights/collect_insights.py ── Instagram API에서 읽기만 함
        └ 비공개 R2 버킷 (data/*.json, app/*)
              └ Cloudflare Worker (cloudflare-worker/insights-dashboard.js)
                    └ Cloudflare Access: 본인 이메일로 로그인해야 열림
```

## 구성 파일
- `collect_insights.py`: 수집기. 프로필 스냅샷, 계정 일별 인사이트(팔로워/비팔로워 도달 포함), 게시물별 인사이트를 모아 `recipes.json`의 레시피 정보와 합칩니다.
- `dashboard/`: 대시보드 화면(개요 / 게시물 / 심화 분석 탭). 외부 스크립트 없이 동작합니다.
- `../cloudflare-worker/insights-dashboard.js`: 대시보드를 내려주는 Worker. Access 로그인 토큰을 다시 검증하고, 정해진 파일만 내려줍니다.
- `../.github/workflows/insights-collect.yml`: 매일 수집. `insights/dashboard/`가 바뀌면 화면 파일만 다시 올립니다.

## 처음 한 번 설정하기

### 1. Instagram 토큰 권한 확인
기존 `IG_ACCESS_TOKEN`(instagram-sync.yml과 같은 토큰)에 **`instagram_business_manage_insights`** 권한이 있어야 합니다.
권한이 없으면 수집기 로그에 `metric not available`이나 권한 오류가 나옵니다. 그 경우 Meta 개발자 앱에서 해당 권한을 추가하고 토큰을 다시 발급하세요.

### 2. 비공개 R2 버킷 만들기 (Cloudflare 대시보드 → R2)
1. 새 버킷을 만듭니다(예: `ig-insights`). 이미지용 기존 버킷과는 **반드시 분리**합니다(기존 버킷은 공개 상태).
2. 버킷 설정에서 **Public access(r2.dev), Custom domain을 모두 끈 상태**로 둡니다.
3. R2 → API 토큰 관리에서 토큰을 만듭니다. 권한은 **Object Read & Write**, 적용 범위는 **이 버킷 하나만** 지정합니다.

### 3. GitHub Secrets 추가 (저장소 Settings → Secrets and variables → Actions)
| 이름 | 값 |
|---|---|
| `INSIGHTS_R2_ENDPOINT` | `https://<계정 ID>.r2.cloudflarestorage.com` |
| `INSIGHTS_R2_ACCESS_KEY_ID` | 2-3에서 만든 토큰의 Access Key ID |
| `INSIGHTS_R2_SECRET_ACCESS_KEY` | 같은 토큰의 Secret Access Key |
| `INSIGHTS_R2_BUCKET` | 버킷 이름 (예: `ig-insights`) |

`IG_ACCESS_TOKEN`, `IG_USER_ID`는 이미 등록된 값을 그대로 씁니다.

### 4. Worker 만들기 (Workers & Pages → Create → Worker)
1. 이름을 정하고(예: `insights-dashboard`) `cloudflare-worker/insights-dashboard.js` 내용을 붙여 넣어 배포합니다.
2. Settings → Bindings → **R2 bucket** 추가: 변수 이름 `INSIGHTS`, 버킷은 2번에서 만든 버킷.
3. Settings → Domains & Routes에서 **Custom domain**을 연결합니다(예: `insights.how-about-breakfast.com`).
4. 같은 화면에서 **workers.dev 주소와 Preview URL은 끕니다.** 켜 두더라도 Worker가 로그인 토큰이 없으면 403으로 막지만, 불필요한 입구를 없애는 게 안전합니다.

### 5. Cloudflare Access로 본인만 들어오게 막기 (Zero Trust → Access → Applications)
1. **Self-hosted** 애플리케이션을 추가하고, 도메인에 4-3의 주소를 넣습니다.
2. 정책(Policy)은 Action **Allow**, Include → **Emails** → 본인 이메일 하나만 넣습니다.
3. 로그인 방식은 **One-time PIN**(이메일로 받는 일회용 코드)이면 충분합니다.
4. 저장한 뒤 애플리케이션 개요에서 **Application Audience (AUD) Tag**를 복사해 둡니다.
5. Zero Trust → Settings → Custom Pages(또는 General)에서 **팀 도메인**(`<팀이름>.cloudflareaccess.com`)을 확인합니다.

### 6. Worker 변수 입력 (Worker → Settings → Variables and Secrets)
| 이름 | 값 |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `<팀이름>.cloudflareaccess.com` |
| `ACCESS_AUD` | 5-4에서 복사한 AUD Tag |
| `ALLOWED_EMAIL` | 5-2에 넣은 본인 이메일 |

값이 하나라도 비어 있으면 Worker는 아무것도 내려주지 않고 503을 돌려줍니다(설정 실수 시 데이터가 새지 않도록).

### 7. 첫 수집 실행
이 브랜치가 `main`에 병합돼야 예약 실행이 시작됩니다. 병합 후 Actions → **Instagram insights collect** → Run workflow에서 `full`을 체크하고 한 번 실행하세요.
처음에는 전체 게시물 인사이트를 가져오느라 수 분이 걸립니다. 그 뒤로는 매일 06:30에 자동 실행됩니다.

## 알아둘 점
- **팔로워 수 추이는 수집을 시작한 날부터 쌓입니다.** Instagram API는 현재 팔로워 수만 알려주기 때문입니다.
- **계정 일별 인사이트는 최근 약 30일 치만** 조회할 수 있습니다. 수집이 며칠 빠져도 30일 안이면 다음 실행에서 채워집니다.
- **게시물별 인사이트**: 최근 45일 이내 게시물은 매일, 나머지는 일주일에 한 번 새로 가져옵니다.
- **게시물별 날짜 기록** (`data/post_history.json`): 올린 지 45일 이내 게시물의 누적 수치를 매일 한 번씩 남깁니다. "올린 뒤 며칠 만에 얼마나 퍼졌나"를 보기 위한 기록으로, 수집을 시작한 날부터 쌓입니다(1년에 약 2~3MB). 화면 표시는 심화 분석 탭에서 추가할 예정이라, 그때 Worker 코드도 함께 갱신합니다.
- **API가 거부한 지표**: 수집기가 실패하지 않고 건너뛴 뒤 `meta.json`에 기록합니다. 목록은 대시보드 '심화 분석' 탭 하단에서 볼 수 있습니다.
- **확산 지수** = 게시물 도달 ÷ 게시 당시 팔로워 수입니다. 수집 시작 전 게시물은 수집 첫날의 팔로워 수로 계산하므로 실제보다 낮게 나올 수 있습니다.

## 인스타그램 토큰 만료 표시
- 대시보드 제목 아래에 **토큰 만료 예정일(D-day)**이 나옵니다. 14일 이하로 남으면 ⚠, 만료되거나 토큰 오류로 수집이 멈추면 ⛔ 표시가 뜹니다.
- 인스타그램 API는 발급일을 알려주지 않습니다. 그래서 수집기가 **토큰이 바뀐 날**을 알아채고(토큰은 저장하지 않고 되돌릴 수 없는 짧은 지문만 비교), 그날부터 60일을 셉니다. 따라서 토큰을 교체하면 다음 날 수집부터 정확한 날짜가 표시됩니다.
- 처음 수집할 때 쓰던 토큰은 발급일을 몰라서 첫 수집일 기준으로 추정합니다(실제로는 더 빠를 수 있음). 발급일을 알면 저장소 **Settings → Secrets and variables → Actions → Variables** 탭에 `IG_TOKEN_ISSUED_AT` = `YYYY-MM-DD`를 넣어 바로잡을 수 있습니다(비밀값이 아니므로 Variables에 넣습니다).
- 토큰을 교체할 때는 **GitHub Secrets의 `IG_ACCESS_TOKEN`과 Cloudflare `edit-api` Worker의 `IG_ACCESS_TOKEN` 두 곳**을 모두 바꿔 주세요.

## 보안·개인정보 점검 (OWASP Top 10 기준)
| 항목 | 적용 내용 |
|---|---|
| A01 접근 통제 | Cloudflare Access(본인 이메일만) + Worker에서 Access JWT 서명·aud·iss·만료·이메일 재검증. 설정 누락 시 503으로 차단(fail closed). 허용 목록에 있는 파일만 제공. GET 외 메서드 거부 |
| A02 암호화 실패 | 모든 통신 HTTPS. 토큰·키는 GitHub Secrets, Worker Secrets에만 보관하고 저장소와 로그에는 남기지 않음 |
| A03 인젝션 | 대시보드는 데이터를 `textContent`로만 넣음(innerHTML 미사용). 외부 링크는 instagram.com, 이미지는 사이트 이미지 도메인만 허용 |
| A05 보안 설정 | CSP(`default-src 'none'`, 인라인 스크립트·스타일 금지), X-Frame-Options DENY, nosniff, no-referrer, no-store, noindex |
| A06 취약 구성요소 | 대시보드에 외부 라이브러리·CDN 없음. 수집기 의존성은 boto3 하나 |
| A07 인증 | 비밀번호를 직접 다루지 않고 Cloudflare Access 일회용 코드 로그인에 위임 |
| A09 로깅 | 공개 저장소라 Actions 로그가 공개되므로 건수와 지표 이름만 출력하고 수치는 출력하지 않음 |
| A10 SSRF | 페이지네이션 URL은 graph.instagram.com 호스트일 때만 따라감(토큰이 다른 곳으로 전송되지 않게) |

**개인정보 최소 수집**: 본인 계정의 집계 수치와 본인이 쓴 캡션만 저장합니다. 댓글 내용, 다른 사용자의 아이디 같은 제3자 정보는 요청하지도 저장하지도 않습니다.
데이터를 지우려면 R2 버킷의 `data/` 폴더를 삭제하면 됩니다.

## 로컬에서 확인하기
```bash
# 실제 API로 수집하되 R2 대신 로컬 폴더에 저장 (폴더는 커밋 금지: .gitignore 처리됨)
IG_ACCESS_TOKEN=... IG_USER_ID=... python insights/collect_insights.py --local insights/_local
python -m http.server 8000 -d insights/_local   # http://localhost:8000/app/index.html
```
