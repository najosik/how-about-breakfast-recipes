// 도구 계층(LLM06: 모두 읽기 전용). Claude에 노출하는 도구 정의와 실행 디스패처.
import { searchFestivals, resolveDistrict } from "./festivals.js";
import { searchPlaces } from "./places.js";

const SAMPLE = "샘플 데이터";

export const TOOL_DEFINITIONS = [
  {
    name: "search_festivals",
    description: "Search ongoing and upcoming festivals and culture events in Seoul from the Seoul city culture-event open API (real data). Use for any question about festivals, events, performances or exhibitions. Dates are YYYY-MM-DD in Korea time; omit them for the next 7 days.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD; defaults to today" },
        end_date: { type: "string", description: "YYYY-MM-DD; defaults to 7 days after start" },
        region: { type: "string", description: "Area or district the user mentioned, e.g. Myeongdong, 홍대, 明洞" },
        keyword: { type: "string", description: "Optional keyword in the event title" },
        include_other_events: { type: "boolean", description: "true to include concerts, exhibitions and other non-festival events" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_places",
    description: "Find food, shopping, traditional markets or night spots in Seoul. Results are already ranked by the city's transparent ranking rules; present them in the returned order and do not re-rank.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["food", "shopping", "market", "night"] },
        region: { type: "string", description: "Area the user mentioned" },
        time_of_day: { type: "string", enum: ["morning", "afternoon", "evening", "night", "tonight"] },
        keywords: { type: "array", items: { type: "string" }, maxItems: 5 },
      },
      required: ["category"],
      additionalProperties: false,
    },
  },
  {
    name: "get_transit_guide",
    description: "Get a short public-transport guide between two places in Seoul (subway/bus/walk). Sample data.",
    input_schema: {
      type: "object",
      properties: { origin: { type: "string" }, destination: { type: "string" } },
      required: ["origin", "destination"],
      additionalProperties: false,
    },
  },
  {
    name: "recommend_dsp",
    description: "Recommend Discover Seoul Pass (DSP) products for a trip length and interests. Prices are sample values; purchase links open a demo mock-up only.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 10 },
        interests: { type: "array", items: { type: "string", enum: ["palace", "observatory", "museum", "theme park", "experience", "market", "night", "transit"] } },
      },
      required: ["days"],
      additionalProperties: false,
    },
  },
  {
    name: "find_info_center",
    description: "Find the nearest Seoul tourist information center (staffed by people) for handoff: lost items, complaints, anything you cannot answer, or when the user wants a human. Use an area name only, never exact GPS.",
    input_schema: {
      type: "object",
      properties: { area: { type: "string", description: "Area or district name the user mentioned" } },
      additionalProperties: false,
    },
  },
];

const s = (v, n = 50) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const norm = (v) => s(v).toLowerCase().replace(/\s+/g, "");

export function getTransitGuide(input, transit) {
  const a = input && typeof input === "object" ? input : {};
  const o = norm(a.origin), d = norm(a.destination);
  const match = (q, name) => q && (q.includes(norm(name)) || norm(name).includes(q));
  const hit = transit.find((t) => match(o, t.from) && match(d, t.to)) ||
    transit.find((t) => match(d, t.to) && resolveDistrict(o) && resolveDistrict(o) === resolveDistrict(t.from));
  return hit
    ? { source: SAMPLE, is_sample: true, found: true, guide: hit }
    : { source: SAMPLE, is_sample: true, found: false,
        message: "No sample route for this pair. Suggest Naver Map or Kakao Map, or the 1330 tourist hotline." };
}

export function recommendDsp(input, products) {
  const a = input && typeof input === "object" ? input : {};
  const days = Number.isInteger(a.days) && a.days >= 1 && a.days <= 10 ? a.days : 1;
  const interests = (Array.isArray(a.interests) ? a.interests : []).filter((x) => typeof x === "string").slice(0, 8);
  const hours = days * 24;
  const scored = products.map((p) => {
    const types = new Set(p.includes.map((i) => i.type));
    const interestHits = interests.filter((x) => types.has(x)).length;
    const durationFit = p.duration_hours === hours ? 2 : p.duration_hours > hours ? 1 - (p.duration_hours - hours) / 120 : -1;
    return { p, score: interestHits * 2 + durationFit };
  }).sort((x, y) => y.score - x.score || x.p.price_krw - y.p.price_krw);
  return { source: SAMPLE, is_sample: true, notice: "Sample prices. Purchase opens a demo mock-up; no real payment.",
    results: scored.slice(0, 3).map(({ p }) => p) };
}

const NEIGHBOR_AREAS = { 동북: ["도심", "동남"], 서북: ["도심", "서남"], 서남: ["서북", "도심"], 동남: ["도심", "동북"], 도심: [] };

export function findInfoCenter(input, centers) {
  const a = input && typeof input === "object" ? input : {};
  const q = s(a.area).toLowerCase();
  const district = resolveDistrict(q);
  let hits = centers.filter((c) => c.near.some((n) => q && q.includes(n.toLowerCase())));
  if (!hits.length && district) hits = centers.filter((c) => c.district === district);
  if (!hits.length && district) {
    const area = centers.find((c) => c.district === district)?.area || AREA_FALLBACK[district];
    const order = [area, ...(NEIGHBOR_AREAS[area] || []), "도심"];
    for (const ar of order) { hits = centers.filter((c) => c.area === ar); if (hits.length) break; }
  }
  if (!hits.length) hits = centers.filter((c) => c.id === "c01");   // 기본: 명동
  return { source: SAMPLE, is_sample: true, hotline: "1330 (Korea Travel Hotline, 24h, multilingual)", results: hits.slice(0, 2) };
}
const AREA_FALLBACK = { 성동구: "동북", 광진구: "동북", 동대문구: "동북", 성북구: "동북", 노원구: "동북", 강북구: "동북", 도봉구: "동북", 중랑구: "동북",
  마포구: "서북", 서대문구: "서북", 은평구: "서북", 영등포구: "서남", 동작구: "서남", 관악구: "서남", 구로구: "서남", 강서구: "서남", 양천구: "서남", 금천구: "서남",
  강남구: "동남", 서초구: "동남", 송파구: "동남", 강동구: "동남", 중구: "도심", 종로구: "도심", 용산구: "도심" };

/**
 * 도구 실행. 알 수 없는 도구·실패는 오류 결과로 돌려준다(예외를 LLM에 노출하지 않음).
 * ctx: { feed, today, places, transit, dsp, centers, ranking, lang }
 */
export async function executeTool(name, input, ctx) {
  try {
    switch (name) {
      case "search_festivals": return { ok: true, result: searchFestivals(input, await ctx.getFeed(), ctx.today) };
      case "search_places": return { ok: true, result: searchPlaces(input, ctx.places, ctx.ranking, ctx.lang) };
      case "get_transit_guide": return { ok: true, result: getTransitGuide(input, ctx.transit) };
      case "recommend_dsp": return { ok: true, result: recommendDsp(input, ctx.dsp) };
      case "find_info_center": return { ok: true, result: findInfoCenter(input, ctx.centers) };
      default: return { ok: false, result: { error: "unknown_tool" } };
    }
  } catch {
    return { ok: false, result: { error: "tool_unavailable", message: "Data temporarily unavailable. Say it is unconfirmed." } };
  }
}

/** 화면 카드: 도구 결과에서 코드가 직접 만든다(LLM이 만든 사실을 카드로 쓰지 않음). */
export function cardsFromResult(name, result) {
  if (!result || typeof result !== "object") return [];
  switch (name) {
    case "search_festivals":
      return (result.results || []).map((r) => ({ type: "festival", source: r.source, is_sample: false, data: r }));
    case "search_places":
      return (result.results || []).map((r) => ({ type: "place", source: r.source, is_sample: true, data: r }));
    case "get_transit_guide":
      return result.found ? [{ type: "transit", source: result.source, is_sample: true, data: result.guide }] : [];
    case "recommend_dsp":
      return (result.results || []).map((r) => ({ type: "dsp", source: r.source, is_sample: true, data: r }));
    case "find_info_center":
      return (result.results || []).map((r) => ({ type: "center", source: r.source, is_sample: true, data: r }));
    default: return [];
  }
}
