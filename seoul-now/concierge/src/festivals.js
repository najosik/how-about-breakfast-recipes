// search_festivals 도구: 기존 축제 모듈(seoul-now/scripts/fetch_events.py) 어댑터.
// 모듈을 재작성하지 않고, 그 모듈이 6시간마다 만드는 events.json(정규화된 응답)을 읽어
// 기간·지역·키워드로 걸러 도구 응답 형태로 바꿔 줄 뿐이다.

export const FESTIVAL_SOURCE = "서울시 문화행사 정보 API";
const MAX_RESULTS = 8;
const MAX_RANGE_DAYS = 31;

// 관광객이 흔히 쓰는 지역명 → 자치구 (한/영/일/중 표기)
const AREA_TO_DISTRICT = [
  [["명동", "myeongdong", "明洞", "을지로", "euljiro", "남대문", "namdaemun", "南大门", "南大門", "시청", "city hall", "남산", "namsan", "南山", "동대문", "dongdaemun", "东大门", "東大門", "ddp"], "중구"],
  [["종로", "jongno", "钟路", "鍾路", "인사동", "insadong", "仁寺洞", "경복궁", "gyeongbokgung", "景福宫", "景福宮", "북촌", "bukchon", "北村", "광화문", "gwanghwamun", "光化门", "光化門", "익선동", "ikseondong", "삼청동", "samcheong", "대학로", "daehakro"], "종로구"],
  [["홍대", "hongdae", "弘大", "연남", "yeonnam", "망원", "mangwon", "합정", "hapjeong", "상암", "sangam", "마포", "mapo"], "마포구"],
  [["이태원", "itaewon", "梨泰院", "용산", "yongsan", "龙山", "龍山", "한남", "hannam"], "용산구"],
  [["강남", "gangnam", "江南", "코엑스", "coex", "삼성동", "samseong", "압구정", "apgujeong", "신사", "sinsa", "가로수길", "garosu", "청담", "cheongdam"], "강남구"],
  [["잠실", "jamsil", "蚕室", "蠶室", "롯데월드", "lotte world", "석촌", "seokchon", "송파", "songpa", "올림픽공원", "olympic park"], "송파구"],
  [["성수", "seongsu", "圣水", "聖水", "서울숲", "seoul forest", "왕십리", "wangsimni"], "성동구"],
  [["여의도", "yeouido", "汝矣岛", "汝矣島", "영등포", "yeongdeungpo", "문래", "mullae"], "영등포구"],
  [["신촌", "sinchon", "新村", "이대", "ewha", "연희", "yeonhui", "서대문", "seodaemun"], "서대문구"],
  [["서초", "seocho", "예술의전당", "seoul arts center", "고속터미널", "express bus terminal", "반포", "banpo"], "서초구"],
  [["건대", "konkuk", "광진", "gwangjin", "어린이대공원", "children's grand park"], "광진구"],
  [["성북", "seongbuk", "혜화", "hyehwa"], "성북구"],
  [["노원", "nowon"], "노원구"], [["은평", "eunpyeong"], "은평구"], [["강서", "gangseo", "마곡", "magok", "김포공항", "gimpo airport"], "강서구"],
  [["구로", "guro"], "구로구"], [["관악", "gwanak"], "관악구"], [["동작", "dongjak", "노량진", "noryangjin"], "동작구"],
  [["강동", "gangdong"], "강동구"], [["양천", "yangcheon", "목동", "mokdong"], "양천구"], [["금천", "geumcheon"], "금천구"],
  [["동대문구", "청량리", "cheongnyangni", "경동시장", "gyeongdong market"], "동대문구"], [["중랑", "jungnang"], "중랑구"],
  [["강북", "gangbuk", "북한산", "bukhansan"], "강북구"], [["도봉", "dobong"], "도봉구"],
];
const DISTRICTS = new Set(AREA_TO_DISTRICT.map(([, d]) => d).concat(["중구", "종로구"]));

/** 지역명(자유 입력) → 자치구. 모르면 null(지역 필터를 걸지 않음). */
export function resolveDistrict(region) {
  if (typeof region !== "string") return null;
  const q = region.trim().toLowerCase().slice(0, 50);
  if (!q) return null;
  for (const d of DISTRICTS) if (q.includes(d)) return d;
  for (const [names, district] of AREA_TO_DISTRICT) {
    if (names.some((n) => q.includes(n.toLowerCase()))) return district;
  }
  return null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** 한국 시간 기준 오늘 'YYYY-MM-DD' */
export function kstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 입력 기간 정규화: 과거 시작일은 오늘로 당기고(§7-4 진행·예정만), 최대 31일. */
export function normalizeRange(startDate, endDate, today) {
  let from = ISO.test(startDate || "") ? startDate : today;
  if (from < today) from = today;
  let to = ISO.test(endDate || "") ? endDate : addDays(from, 6);
  if (to < from) to = from;
  const cap = addDays(from, MAX_RANGE_DAYS - 1);
  if (to > cap) to = cap;
  return [from, to];
}

export function isFestival(ev) {
  return typeof ev.category === "string" && ev.category.startsWith("축제");
}

function validEvent(ev) {
  return ev && typeof ev.title === "string" && ISO.test(ev.start) && ISO.test(ev.end);
}

const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u.slice(0, 500) : "");
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

/**
 * search_festivals 도구 본체.
 * @param {object} input  { start_date?, end_date?, region?, keyword?, include_other_events? }
 * @param {object} feed   events.json 내용 { updatedAt, events: [...] }
 * @param {string} today  KST 'YYYY-MM-DD'
 */
export function searchFestivals(input, feed, today) {
  const args = input && typeof input === "object" ? input : {};
  const [from, to] = normalizeRange(args.start_date, args.end_date, today);
  const district = resolveDistrict(args.region);
  const keyword = str(args.keyword, 30).trim().toLowerCase();
  const includeOther = args.include_other_events === true;

  const events = Array.isArray(feed && feed.events) ? feed.events.filter(validEvent) : [];
  let hits = events.filter((ev) =>
    ev.end >= from && ev.start <= to &&
    (includeOther || isFestival(ev)) &&
    (!district || ev.district === district) &&
    (!keyword || `${ev.title} ${ev.place} ${ev.category} ${ev.program || ""}`.toLowerCase().includes(keyword)));
  // 진행 중인 행사 → 곧 시작하는 행사 순, 같은 조건이면 무료 우선
  hits.sort((a, b) => (a.start <= today) !== (b.start <= today) ? (a.start <= today ? -1 : 1)
    : a.start.localeCompare(b.start) || Number(b.free) - Number(a.free));

  return {
    source: FESTIVAL_SOURCE,
    is_sample: false,
    data_updated_at: str(feed && feed.updatedAt, 40),
    query: { start_date: from, end_date: to, district: district || "서울 전체", keyword: keyword || null,
      festivals_only: !includeOther },
    total_matches: hits.length,
    results: hits.slice(0, MAX_RESULTS).map((ev) => ({
      id: str(ev.id, 20), title: str(ev.title, 200), category: str(ev.category, 40),
      district: str(ev.district, 20), place: str(ev.place, 200),
      start: ev.start, end: ev.end, ongoing: ev.start <= today,
      free: ev.free === true, fee: str(ev.fee, 200),
      lat: Number.isFinite(ev.lat) ? ev.lat : null, lng: Number.isFinite(ev.lng) ? ev.lng : null,
      link: safeUrl(ev.link || ev.homepage), image: safeUrl(ev.image),
      source: FESTIVAL_SOURCE, is_sample: false,
    })),
  };
}

/** Worker에서 events.json 읽기(10분 캐시). URL은 환경변수 EVENTS_URL로 교체 가능. */
export async function loadFeed(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { cf: { cacheTtl: 600, cacheEverything: true } });
  if (!res.ok) throw new Error(`events feed HTTP ${res.status}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.events)) throw new Error("events feed invalid");
  return json;
}
