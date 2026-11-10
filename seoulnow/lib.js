// Seoul Now 프론트엔드 — 화면과 분리된 순수 로직(날짜·필터·정렬·주소 검증·.ics). Node 테스트에서도 그대로 불러 쓴다.
// 데이터: ../seoul-now/data/events.json (백엔드 수집본). 모든 날짜는 서울 시간(Asia/Seoul) 기준 'YYYY-MM-DD'.

export const PAGE_SIZE = 20;
export const PERIODS = ["today", "weekend", "month", "all"];
export const SORTS = ["date", "ending", "recent"];

export const GENRES = [
  { code: "perf", ko: "공연", en: "Performances", match: ["콘서트", "클래식", "국악", "독주/독창회", "연극", "뮤지컬/오페라", "무용"] },
  { code: "exhibit", ko: "전시", en: "Exhibitions", match: ["전시/미술"] },
  { code: "festival", ko: "축제", en: "Festivals", prefix: "축제" },
  { code: "edu", ko: "교육·체험", en: "Classes", match: ["교육/체험"] },
  { code: "film", ko: "영화", en: "Film", match: ["영화"] },
  { code: "other", ko: "기타", en: "Other" },
];

// 25개 자치구를 5개 생활권역으로(스타일 가이드 5장)
export const AREAS = [
  { code: "center", ko: "도심권", en: "Central", gu: [["jongno", "종로구", "Jongno"], ["jung", "중구", "Jung"], ["yongsan", "용산구", "Yongsan"]] },
  { code: "northeast", ko: "동북권", en: "Northeast", gu: [["seongdong", "성동구", "Seongdong"], ["gwangjin", "광진구", "Gwangjin"], ["dongdaemun", "동대문구", "Dongdaemun"], ["jungnang", "중랑구", "Jungnang"], ["seongbuk", "성북구", "Seongbuk"], ["gangbuk", "강북구", "Gangbuk"], ["dobong", "도봉구", "Dobong"], ["nowon", "노원구", "Nowon"]] },
  { code: "northwest", ko: "서북권", en: "Northwest", gu: [["eunpyeong", "은평구", "Eunpyeong"], ["seodaemun", "서대문구", "Seodaemun"], ["mapo", "마포구", "Mapo"]] },
  { code: "southwest", ko: "서남권", en: "Southwest", gu: [["yangcheon", "양천구", "Yangcheon"], ["gangseo", "강서구", "Gangseo"], ["guro", "구로구", "Guro"], ["geumcheon", "금천구", "Geumcheon"], ["yeongdeungpo", "영등포구", "Yeongdeungpo"], ["dongjak", "동작구", "Dongjak"], ["gwanak", "관악구", "Gwanak"]] },
  { code: "southeast", ko: "동남권", en: "Southeast", gu: [["seocho", "서초구", "Seocho"], ["gangnam", "강남구", "Gangnam"], ["songpa", "송파구", "Songpa"], ["gangdong", "강동구", "Gangdong"]] },
];
export const GU = new Map(AREAS.flatMap((a) => a.gu.map(([code, ko, en]) => [code, { code, ko, en, area: a.code }])));
export const GU_BY_NAME = new Map([...GU.values()].map((g) => [g.ko, g]));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, "0");

/** 서울 시간 기준 오늘 날짜 */
export function kstToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekday = (iso) => new Date(iso + "T00:00:00Z").getUTCDay();   // 0=일
export const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
export const monthOf = (iso) => iso.slice(0, 7);
export function lastDayOfMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/** 오늘부터 앞으로 n개월 'YYYY-MM' (이번 달 포함) */
export function monthsAhead(today, n = 12) {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 + i, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; });
}

/**
 * 기간 → [시작, 끝] 날짜(포함). '이번 주말'은 금 18:00~일 24:00이지만 원천 데이터가 날짜 단위라 금~일로 본다.
 * 월~목이면 다가오는 주말, 금~일이면 이번 주말.
 */
export function periodRange(period, today) {
  if (period === "today") return [today, today];
  if (period === "weekend") {
    const w = weekday(today);
    const fri = w === 0 ? addDays(today, -2) : w === 6 ? addDays(today, -1) : addDays(today, (5 - w + 7) % 7);
    return [fri < today ? today : fri, addDays(fri, 2)];
  }
  if (period === "month") return [today, lastDayOfMonth(monthOf(today))];
  return [today, "9999-12-31"];
}
export function monthRange(ym, today) {
  const first = `${ym}-01`;
  return [first < today ? today : first, lastDayOfMonth(ym)];
}

export function genreOf(category) {
  const c = String(category || "");
  for (const g of GENRES) {
    if (g.match && g.match.includes(c)) return g.code;
    if (g.prefix && c.startsWith(g.prefix)) return g.code;
  }
  return "other";
}

/** 주소 쿼리 → 화면 상태. 허용 목록에 없는 값은 버리고 기본값(스타일 가이드 5장 'URL 동기화'). 쿼리 값은 화면에 그대로 쓰지 않는다. */
export function parseQuery(search, today) {
  const p = new URLSearchParams(typeof search === "string" ? search : "");
  const list = (k, allowed) => [...new Set(String(p.get(k) || "").split(",").map((x) => x.trim()).filter((x) => allowed.has(x)))].slice(0, 25);
  const months = new Set(monthsAhead(today, 12));
  const month = months.has(p.get("month")) ? p.get("month") : null;
  let period = PERIODS.includes(p.get("period")) ? p.get("period") : (month ? "all" : "month");
  if (month && period !== "all") period = "all";   // 월을 고르면 기간 탭은 '전체'
  const ev = p.get("event");
  return {
    lang: p.get("lang") === "en" ? "en" : "ko",
    period,
    month: month === monthOf(today) && period === "all" ? null : month,
    gu: list("gu", new Set(GU.keys())),
    genre: list("genre", new Set(GENRES.map((g) => g.code))),
    sort: SORTS.includes(p.get("sort")) ? p.get("sort") : "date",
    ended: p.get("ended") === "1",
    pick: PICKS.includes(p.get("pick")) ? p.get("pick") : "all",
    event: ev && /^[0-9a-f]{6,40}$/.test(ev) ? ev : null,
  };
}
// 이번 달을 월 패널에서 고르면 '이번 달' 탭과 같으므로 period=month로 정리
export function normalizeState(s, today) {
  if (s.month && s.month === monthOf(today)) return { ...s, month: null, period: "month" };
  return s;
}

/** 화면 상태 → 주소 쿼리(기본값은 생략) */
export function toQuery(s, { includeEvent = true } = {}) {
  const p = new URLSearchParams();
  if (s.lang !== "ko") p.set("lang", s.lang);
  if (includeEvent && s.event) { p.set("event", s.event); return `?${p}`; }   // 공유 주소에는 행사 ID만
  if (s.period !== "month") p.set("period", s.period);
  if (s.month) p.set("month", s.month);
  if (s.gu.length) p.set("gu", s.gu.join(","));
  if (s.genre.length) p.set("genre", s.genre.join(","));
  if (s.sort !== "date") p.set("sort", s.sort);
  if (s.ended) p.set("ended", "1");
  if (s.pick && s.pick !== "all") p.set("pick", s.pick);
  const q = p.toString();
  return q ? `?${q}` : "";
}

export function validEvent(e) {
  return e && typeof e.id === "string" && typeof e.title === "string" && DATE_RE.test(e.start) && DATE_RE.test(e.end) && e.start <= e.end;
}

export const overlaps = (ev, [a, b]) => ev.end >= a && ev.start <= b;

/** 날짜 범위: 기간 탭 또는 월 */
export function activeRange(s, today) {
  const r = s.month ? monthRange(s.month, today) : periodRange(s.period, today);
  if (!s.ended) return r;
  // 종료된 행사 포함: 이번 달·특정 월은 그 달 1일부터, 전체 기간은 처음부터
  if (s.month) return [`${s.month}-01`, r[1]];
  if (s.period === "month") return [`${monthOf(today)}-01`, r[1]];
  if (s.period === "all") return ["0000-01-01", r[1]];
  return r;
}

/** 선별 단계: all(전체), s1(1차 관광 선별), s2(2차 외국인 선별 = 1차 통과 중 외국인 적합) */
export const PICKS = ["all", "s1", "s2"];
const idSet = (list) => new Set((Array.isArray(list) ? list : []).map((x) => (typeof x === "string" ? x : x && x.id)).filter((x) => typeof x === "string"));
const own = (o, k) => !!o && typeof o === "object" && Object.hasOwn(o, k);

/**
 * 백엔드 선별 결과로 행사별 단계(0: 미통과, 1: 1차 통과, 2: 2차 통과)를 계산. 기존 /seoul-now/와 같은 규칙.
 * 1차: tourism_select.json의 pass(담당자 고정·제외는 백엔드에서 이미 반영).
 * 2차: 1차 통과 + 담당자 제외 아님 + (담당자 추천 또는 언어 장벽 낮음·참여 제한 없음·국내 본인인증 예약 아님).
 * 선별 데이터가 없으면 null(필터를 쓰지 않음).
 */
export function buildStages(events, select, tags, overrides) {
  if (!select || typeof select !== "object" || !select.select || typeof select.select !== "object") return null;
  const pin = idSet(overrides && overrides.pin), exc = idSet(overrides && overrides.exclude);
  const tg = tags && typeof tags === "object" ? tags : {};
  const out = new Map();
  for (const ev of events) {
    const r = own(select.select, ev.id) ? select.select[ev.id] : null;
    if (!r || r.pass !== true) { out.set(ev.id, 0); continue; }
    let s2;
    if (exc.has(ev.id)) s2 = false;
    else if (pin.has(ev.id)) s2 = true;
    else {
      const x = own(tg, ev.id) ? tg[ev.id] : null;
      s2 = !!x && typeof x === "object" && x.language_barrier === "low" && x.audience_restricted !== true && x.reservation_barrier !== "kr_auth_required";
    }
    out.set(ev.id, s2 ? 2 : 1);
  }
  return out;
}

/** 필터. omit에 적힌 조건은 빼고 계산(탭·패널·시트의 건수용). stages: buildStages 결과(없으면 선별 조건 무시) */
export function filterEvents(events, s, today, omit = [], stages = null) {
  const skip = new Set(omit);
  const range = skip.has("range") ? null : activeRange(s, today);
  const gus = !skip.has("gu") && s.gu.length ? new Set(s.gu.map((c) => GU.get(c)?.ko).filter(Boolean)) : null;
  const genres = !skip.has("genre") && s.genre.length ? new Set(s.genre) : null;
  const need = !skip.has("pick") && stages && s.pick === "s2" ? 2 : !skip.has("pick") && stages && s.pick === "s1" ? 1 : 0;
  return events.filter((ev) => {
    if (need && (stages.get(ev.id) || 0) < need) return false;
    if (!s.ended && ev.end < today) return false;
    if (range && !overlaps(ev, range)) return false;
    if (gus && !gus.has(ev.district)) return false;
    if (genres && !genres.has(genreOf(ev.category))) return false;
    return true;
  });
}

export function sortEvents(list, sort, today) {
  const by = (f) => [...list].sort((a, b) => f(a, b) || a.title.localeCompare(b.title, "ko"));
  if (sort === "ending") return by((a, b) => a.end.localeCompare(b.end)).filter((e) => e.end >= today);
  if (sort === "recent") return by((a, b) => String(b.registered || "").localeCompare(String(a.registered || "")) || b.start.localeCompare(a.start));
  // 날짜순: 진행 중 먼저, 그다음 시작일 빠른 순
  return by((a, b) => Number(b.start <= today) - Number(a.start <= today) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

/** 상태 배지: 종료 / 마감 임박(종료 3일 이내) / 진행 중 / D-n */
export function statusOf(ev, today) {
  if (ev.end < today) return { key: "ended" };
  if (ev.start <= today) return daysBetween(today, ev.end) <= 3 ? { key: "closing", days: daysBetween(today, ev.end) } : { key: "ongoing" };
  return { key: "dday", days: daysBetween(today, ev.start) };
}

const WD = { ko: ["일", "월", "화", "수", "목", "금", "토"], en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };
/** '2026.11.07(토) – 11.30(월)', 같은 해면 끝 연도 생략 */
export function formatRange(start, end, lang = "ko") {
  const w = WD[lang] || WD.ko;
  const one = (iso, withYear) => `${withYear ? iso.slice(0, 4) + "." : ""}${iso.slice(5, 7)}.${iso.slice(8, 10)}(${w[weekday(iso)]})`;
  if (start === end) return one(start, true);
  return `${one(start, true)} – ${one(end, start.slice(0, 4) !== end.slice(0, 4))}`;
}
export const formatShort = (iso, lang = "ko") => `${iso.slice(5, 7)}.${iso.slice(8, 10)}(${(WD[lang] || WD.ko)[weekday(iso)]})`;

/** 캘린더에 추가(.ics, 종일 일정). 값은 RFC 5545 규칙으로 이스케이프 */
export function toIcs(ev, url, stamp = new Date()) {
  const esc = (v) => String(v || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const d = (iso) => iso.replaceAll("-", "");
  const ts = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Seoul Now//KO", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${ev.id}@seoulnow`, `DTSTAMP:${ts}`, `DTSTART;VALUE=DATE:${d(ev.start)}`, `DTEND;VALUE=DATE:${d(addDays(ev.end, 1))}`,
    `SUMMARY:${esc(ev.title)}`, `LOCATION:${esc([ev.district, ev.place].filter(Boolean).join(" "))}`,
    ...(url ? [`URL:${esc(url)}`] : []), "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}

/** http·https만 링크로 쓴다 */
export function safeUrl(u) {
  if (typeof u !== "string" || !u) return "";
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch { return ""; }
}
