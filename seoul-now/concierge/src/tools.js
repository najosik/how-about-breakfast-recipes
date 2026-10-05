// 도구 계층(LLM06: 모두 읽기 전용). Claude에 노출하는 도구 정의와 실행 디스패처.
import { searchFestivals, resolveDistrict } from "./festivals.js";
import { searchPlaces } from "./places.js";
import { tourPlaces, fetchRestaurantDetail } from "./restaurants.js";
import { getGraph, planRoute, resolvePlace, mapLinks, haversineM } from "./transit.js";
import tips from "./data/transit_tips.json" with { type: "json" };

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
    name: "get_restaurant_detail",
    description: "Get opening hours, closed days, signature menu and reservation info for one restaurant returned by search_places (results with a detail_id, from the Korea Tourism Organization TourAPI). Call only when the visitor asks about that restaurant's hours or menu.",
    input_schema: {
      type: "object",
      properties: { detail_id: { type: "string", description: "detail_id from a search_places result, e.g. tour-en-1234567" } },
      required: ["detail_id"],
      additionalProperties: false,
    },
  },
  {
    name: "plan_route",
    description: "Plan how to get from one place to another in Seoul by subway, bus and walking. Returns a walking option when it is close, up to two public-transport options with estimated minutes and transfers, and map-app links (Google Maps, Naver Map). Use an area, landmark or station name; to route to a restaurant or festival from earlier results pass its id. Never ask for exact GPS.",
    input_schema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Where the visitor is, e.g. Myeongdong, Hongik Univ. Station, 明洞. Omit if unknown." },
        destination: { type: "string", description: "Where they want to go" },
        origin_id: { type: "string", description: "id or detail_id of a festival or restaurant from earlier results" },
        destination_id: { type: "string", description: "id or detail_id of a festival or restaurant from earlier results" },
        mode: { type: "string", enum: ["any", "subway", "bus", "walk"], description: "Preferred way; default any" },
        night: { type: "boolean", description: "true if travelling late at night (allows night buses)" },
      },
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

const ROUTE_SOURCE = "서울 열린데이터광장 노선 기반 추정";
const placeName = (p, lang) => (p && p.name ? p.name[lang === "zh-CN" || lang === "zh-TW" ? "zh" : lang] || p.name.en || p.name.ko : "");

/** 이전 결과 id(맛집 detail_id·축제 id) → 좌표. */
async function lookupResult(id, ctx) {
  if (/^tour-(ko|en|ja|zh-CN|zh-TW)-\d{1,12}$/.test(id) && ctx.getTourFood) {
    const [, lang, cid] = id.match(/^tour-([a-zA-Z-]+)-(\d+)$/);
    const food = await ctx.getTourFood().catch(() => null);
    const it = food && food.languages && food.languages[lang] && (food.languages[lang].items || []).find((x) => String(x.id) === cid);
    if (it && Number.isFinite(it.lat)) return { name: { [lang === "zh-CN" || lang === "zh-TW" ? "zh" : lang]: String(it.title).slice(0, 80), ko: lang === "ko" ? String(it.title).slice(0, 80) : undefined }, lat: it.lat, lng: it.lng };
  }
  if (/^[0-9a-f]{6,40}$/.test(id) && ctx.getFeed) {
    const feed = await ctx.getFeed().catch(() => null);
    const ev = feed && Array.isArray(feed.events) && feed.events.find((e) => e.id === id);
    if (ev && Number.isFinite(ev.lat)) return { name: { ko: String(ev.place || ev.title).slice(0, 80) }, lat: ev.lat, lng: ev.lng };
  }
  return null;
}

/** plan_route: 장소 해석 → 오프라인 경로 계산 → 지도 앱 링크·지역 팁. 시간은 모두 추정치. */
async function planRouteTool(input, ctx) {
  const a = input && typeof input === "object" ? input : {};
  const mode = ["any", "subway", "bus", "walk"].includes(a.mode) ? a.mode : "any";
  const net = ctx.getTransit ? await ctx.getTransit().catch(() => null) : null;
  const stations = net && net.subway && Array.isArray(net.subway.stations) ? net.subway.stations : [];
  const resolve = async (text, id) => {
    if (typeof id === "string" && id) { const hit = await lookupResult(id.slice(0, 40), ctx); if (hit) return { ...hit, kind: "result" }; }
    return resolvePlace(typeof text === "string" ? text : "", null, { stations });
  };
  const dest = await resolve(a.destination, a.destination_id);
  const origin = await resolve(a.origin, a.origin_id);
  if (!dest) {
    const q = s(a.destination, 40);
    return { found: false, reason: "destination_unknown", source: ROUTE_SOURCE,
      links: q ? { naver: `https://map.naver.com/p/search/${encodeURIComponent(q)}` } : {},
      message: "Could not place the destination. Ask for a nearby station or landmark, or offer the Naver Map search link." };
  }
  const destLabel = placeName(dest, "ko") || placeName(dest, "en");
  const links = mapLinks(origin, dest, destLabel, ctx.lang);
  const base = { source: ROUTE_SOURCE, estimated: true, destination: { name: placeName(dest, ctx.lang), name_ko: dest.name.ko || "" }, links };
  const nearTips = (tips.tips || []).filter((t) => [origin, dest].some((p) => p && haversineM(p, t.near) <= t.near.radius_m))
    .map((t) => ({ text: t.text[ctx.lang] || t.text.en, is_sample: t.is_sample !== false }));
  if (!origin) {
    return { ...base, found: false, reason: "origin_unknown", tips: nearTips,
      message: "Origin unknown. Ask once which area or station they are near, or offer the map links (they start from the phone's own location)." };
  }
  if (!net) return { ...base, found: true, origin: { name: placeName(origin, ctx.lang) }, options: [], walk: null, tips: nearTips,
    message: "Route data is unavailable right now; offer the map links." };
  const plan = planRoute(getGraph(net), origin, dest, ctx.lang, mode, a.night === true);
  return { ...base, found: true, origin: { name: placeName(origin, ctx.lang), name_ko: origin.name.ko || "" },
    walk: plan.walk, walk_minutes_direct: plan.walk_minutes_direct, options: plan.options, tips: nearTips,
    subway_data: stations.length > 0,
    note: "Estimated times from distances (no real-time data). Check the map app for live routes." };
}

/** 음식 질의면 TourAPI 음식점(사용자 언어 우선, 없으면 국문)을 샘플 장소와 함께 후보로. */
async function placeCandidates(input, ctx) {
  const cat = input && typeof input === "object" ? input.category : null;
  if (cat !== "food" || !ctx.getTourFood) return ctx.places;
  let food = null;
  try { food = await ctx.getTourFood(); } catch { food = null; }
  if (!food) return ctx.places;
  const district = resolveDistrict(typeof input.region === "string" ? input.region.slice(0, 50) : "");
  const tour = tourPlaces(food, ctx.lang, district);
  // 실데이터가 있으면 샘플 음식점은 빼고(샘플이 실데이터를 밀어내지 않게) 전통시장 등 다른 샘플만 남긴다
  return tour.length ? ctx.places.filter((p) => !(p.is_sample && p.category === "food")).concat(tour) : ctx.places;
}

/**
 * 도구 실행. 알 수 없는 도구·실패는 오류 결과로 돌려준다(예외를 LLM에 노출하지 않음).
 * ctx: { today, places, dsp, centers, ranking, lang, getFeed, getTourFood, getTransit, ... }
 */
export async function executeTool(name, input, ctx) {
  try {
    switch (name) {
      case "search_festivals": return { ok: true, result: searchFestivals(input, await ctx.getFeed(), ctx.today, ctx.getFit ? await ctx.getFit() : undefined) };
      case "search_places": return { ok: true, result: searchPlaces(input, await placeCandidates(input, ctx), ctx.ranking, ctx.lang) };
      case "get_restaurant_detail": {
        const r = ctx.getRestaurantDetail ? await ctx.getRestaurantDetail(input && input.detail_id) : { ok: false, error: "detail_unavailable" };
        if (!r.ok) return { ok: true, result: { found: false, error: r.error, message: "Restaurant details are unavailable right now. Suggest checking the Visit Korea site or asking at a tourist information center." } };
        return { ok: true, result: { found: true, ...r.result, needs_translation: r.result.original_lang !== ctx.lang } };
      }
      case "plan_route": return { ok: true, result: await planRouteTool(input, ctx) };
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
      return (result.results || []).map((r) => ({ type: "place", source: r.source, is_sample: r.is_sample !== false, data: r }));
    case "plan_route":
      return result.destination ? [{ type: "route", source: result.source, is_sample: false, data: result }] : [];
    case "recommend_dsp":
      return (result.results || []).map((r) => ({ type: "dsp", source: r.source, is_sample: true, data: r }));
    case "find_info_center":
      return (result.results || []).map((r) => ({ type: "center", source: r.source, is_sample: true, data: r }));
    default: return [];
  }
}
