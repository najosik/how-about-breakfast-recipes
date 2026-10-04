// search_places 도구 + rankPlaces(): 추천 순위는 코드가 결정한다(§4, §6).
// LLM은 이 함수가 돌려준 순서와 점수 내역을 설명만 한다. 결과마다 점수 내역(breakdown)을 남겨
// 감사·설명이 가능하게 한다.
import { resolveDistrict } from "./festivals.js";

export const CATEGORIES = ["food", "shopping", "market", "night"];
const TIME_TO_HOUR = { morning: 9, afternoon: 14, evening: 19, night: 21, tonight: 21 };

// 요청 카테고리별 후보와 카테고리 적합도. 전통시장은 음식·쇼핑 요청에도 후보가 된다.
const CATEGORY_FIT = {
  food: { food: 0.5, market: 0.35 },
  shopping: { shopping: 0.5, market: 0.35 },
  market: { market: 0.5 },
  night: { night: 0.5 },
};

/** 가중치 설정 검증: 숫자이고 -1~1 범위가 아니면 기본값 사용(설정 실수로 순위가 망가지지 않게). */
export function loadRankingConfig(raw) {
  const def = { is_traditional_market: 0.2, is_local_small_business: 0.15, night_after_18: 0.15, is_large_mall_or_duty_free: -0.1 };
  const w = { ...def };
  const src = raw && typeof raw === "object" && raw.weights && typeof raw.weights === "object" ? raw.weights : {};
  for (const k of Object.keys(def)) {
    const v = src[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= -1 && v <= 1) w[k] = v;
  }
  const hour = Number.isInteger(raw && raw.night_hour_from) && raw.night_hour_from >= 0 && raw.night_hour_from <= 23 ? raw.night_hour_from : 18;
  const topN = Number.isInteger(raw && raw.top_n) && raw.top_n >= 1 && raw.top_n <= 10 ? raw.top_n : 5;
  const maxRelated = Number.isInteger(raw && raw.max_related_in_top) && raw.max_related_in_top >= 0 && raw.max_related_in_top <= topN
    ? raw.max_related_in_top : 2;
  return { weights: w, nightHourFrom: hour, topN, maxRelated, guaranteeLocal: !(raw && raw.guarantee_local_in_top_n === false),
    note: (raw && raw.transparency_note) || {} };
}

/** 요청 시간: 0~23 정수 또는 morning/afternoon/evening/night. 없으면 null. */
export function resolveHour(hour, timeOfDay) {
  if (Number.isInteger(hour) && hour >= 0 && hour <= 23) return hour;
  const k = typeof timeOfDay === "string" ? timeOfDay.trim().toLowerCase() : "";
  return Object.hasOwn(TIME_TO_HOUR, k) ? TIME_TO_HOUR[k] : null;
}

const AREA_OF = { 중구: "도심", 종로구: "도심", 용산구: "도심", 성동구: "동북", 광진구: "동북", 동대문구: "동북", 성북구: "동북",
  노원구: "동북", 강북구: "동북", 도봉구: "동북", 중랑구: "동북", 마포구: "서북", 서대문구: "서북", 은평구: "서북",
  영등포구: "서남", 동작구: "서남", 관악구: "서남", 구로구: "서남", 강서구: "서남", 양천구: "서남", 금천구: "서남",
  강남구: "동남", 서초구: "동남", 송파구: "동남", 강동구: "동남" };

/** 질문 적합도(0~1). 카테고리 0.5 + 위치 0.3 + 키워드 0.2 — 모두 규칙 기반. */
export function relevance(place, q) {
  let catFit = 0;
  if (q.category) catFit = (CATEGORY_FIT[q.category] || {})[place.category] || 0;
  else catFit = 0.3;
  if (q.category === "night" && !catFit && place.flags.is_night_content) catFit = 0.3;

  let loc = 0;
  if (q.district) {
    if (place.district === q.district) loc = 0.3;
    else if (AREA_OF[q.district] && AREA_OF[q.district] === place.area) loc = 0.15;
  }
  if (q.regionText && (place.near || []).some((n) => q.regionText.includes(n.toLowerCase()))) loc = 0.3;

  let kw = 0;
  if (q.keywords.length) {
    const hay = [place.name.ko, place.name.en, ...(place.tags || [])].join(" ").toLowerCase();
    if (q.keywords.some((k) => hay.includes(k))) kw = 0.2;
  }
  return { category: catFit, location: loc, keyword: kw, total: Math.min(1, catFit + loc + kw) };
}

const isLocal = (p) => p.flags.is_traditional_market || p.flags.is_local_small_business;
const round = (x) => Math.round(x * 1000) / 1000;

/**
 * rankPlaces: §6 가중치를 코드로 적용.
 * score = relevance + w.market·시장 + w.local·로컬 + w.night·(야간 AND 18시 이후) + w.mall·대형몰/면세점
 * 다양성: 요청과 다른 '관련' 카테고리(예: 쇼핑 질의의 전통시장)는 상위 N에 최대 maxRelated개.
 * 상위 N에 전통시장·로컬 상권이 하나도 없으면, 후보 중 가장 점수가 높은 로컬 장소로 N번째를 교체한다.
 */
export function rankPlaces(places, query, config) {
  const cfg = config && config.weights ? config : loadRankingConfig(config);
  const w = cfg.weights;
  const night = query.hour != null && query.hour >= cfg.nightHourFrom;
  const scored = [];
  for (const p of places) {
    if (!p || !p.flags || !p.name) continue;
    const rel = relevance(p, query);
    if (query.category && rel.category === 0) continue;   // 요청 카테고리와 무관한 장소는 후보에서 제외
    const bonus = {
      is_traditional_market: p.flags.is_traditional_market ? w.is_traditional_market : 0,
      is_local_small_business: p.flags.is_local_small_business ? w.is_local_small_business : 0,
      night_after_18: night && p.flags.is_night_content ? w.night_after_18 : 0,
      is_large_mall_or_duty_free: p.flags.is_large_mall_or_duty_free ? w.is_large_mall_or_duty_free : 0,
    };
    const score = rel.total + Object.values(bonus).reduce((a, b) => a + b, 0);
    scored.push({ place: p, score: round(score), breakdown: { relevance: round(rel.total), relevance_parts: rel, bonus } });
  }
  scored.sort((a, b) => b.score - a.score || a.place.id.localeCompare(b.place.id));

  const top = [];
  let related = 0;
  for (const s of scored) {
    if (top.length >= cfg.topN) break;
    const isRelated = query.category && s.place.category !== query.category;
    if (isRelated && related >= cfg.maxRelated) continue;
    if (isRelated) related++;
    top.push(s);
  }
  let guaranteed = false;
  if (cfg.guaranteeLocal && top.length && !top.some((s) => isLocal(s.place))) {
    const best = scored.find((s) => !top.includes(s) && isLocal(s.place));
    if (best) { top[top.length - 1] = best; guaranteed = true; }
  }
  return { results: top.map((s, i) => ({ rank: i + 1, ...s })), guaranteed_local: guaranteed, candidates: scored.length };
}

const strArg = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

/** search_places 도구 본체. 입력은 LLM이 만든 값이므로 전부 검증한다. */
export function searchPlaces(input, places, config, lang = "en") {
  const a = input && typeof input === "object" ? input : {};
  const category = CATEGORIES.includes(a.category) ? a.category : null;
  const regionText = strArg(a.region, 50).trim().toLowerCase();
  const keywords = (Array.isArray(a.keywords) ? a.keywords : [])
    .filter((k) => typeof k === "string").slice(0, 5).map((k) => k.trim().toLowerCase().slice(0, 30)).filter(Boolean);
  const query = { category, regionText, district: resolveDistrict(regionText), keywords, hour: resolveHour(a.hour, a.time_of_day) };
  const cfg = loadRankingConfig(config);
  const ranked = rankPlaces(places, query, cfg);
  const note = cfg.note[lang] || cfg.note.en || "";
  return {
    sources: [...new Set(ranked.results.map((r) => r.place.source))],
    query: { category: category || "all", district: query.district || "서울 전체", hour: query.hour, keywords },
    ranking_policy: note,
    guaranteed_local: ranked.guaranteed_local,
    results: ranked.results.map((r) => ({
      rank: r.rank, id: r.place.id, name: r.place.name, category: r.place.category,
      district: r.place.district, area: r.place.area, open_hours: r.place.open_hours, open_hours_note: r.place.open_hours_note,
      tags: r.place.tags, flags: r.place.flags, score: r.score, score_breakdown: r.breakdown,
      source: r.place.source, is_sample: r.place.is_sample,
      ...(r.place.detail_ref ? { address: r.place.address, image: r.place.image, image_license: r.place.image_license,
        original_lang: r.place.original_lang, needs_translation: r.place.needs_translation, detail_id: r.place.detail_ref } : {}),
    })),
  };
}
