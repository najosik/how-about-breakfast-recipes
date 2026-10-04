// 한국관광공사 TourAPI 음식점: 하루 1회 수집본(tour_food.json)을 rankPlaces 후보로 바꾸고,
// 상세(detailIntro2)는 요청 시 조회한다. 응답 텍스트는 데이터로만 다루고(LLM01) 태그를 지운다(A03).
import tourCfg from "./config/tourapi.json" with { type: "json" };
import { looksLikeInjection } from "./security.js";

export const TOUR_SOURCE = tourCfg.source_label;
const AREA_OF = { 중구: "도심", 종로구: "도심", 용산구: "도심", 성동구: "동북", 광진구: "동북", 동대문구: "동북", 성북구: "동북",
  노원구: "동북", 강북구: "동북", 도봉구: "동북", 중랑구: "동북", 마포구: "서북", 서대문구: "서북", 은평구: "서북",
  영등포구: "서남", 동작구: "서남", 관악구: "서남", 구로구: "서남", 강서구: "서남", 양천구: "서남", 금천구: "서남",
  강남구: "동남", 서초구: "동남", 송파구: "동남", 강동구: "동남" };
const FOOD_TAGS = { korean: ["korean", "한식"], western: ["western", "양식"], japanese: ["japanese", "일식"],
  chinese: ["chinese", "중식"], fusion: ["fusion", "이색음식"], cafe: ["cafe", "카페", "tea"] };

/** HTML 태그 제거 + 엔티티 일부 해제 + 공백 정리 + 길이 제한. 지시문처럼 보이면 비운다. */
export function cleanText(v, n = 200) {
  if (typeof v !== "string") return "";
  const s = v.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
  return looksLikeInjection(s) ? "" : s;
}
const httpsUrl = (u) => { try { const x = new URL(String(u || "")); return x.protocol === "https:" ? x.href : ""; } catch { return ""; } };

function toPlace(it, lang, translated) {
  const title = cleanText(it.title, 120);
  if (!title || !/^\d{1,12}$/.test(String(it.id))) return null;
  const district = typeof it.district === "string" && AREA_OF[it.district] ? it.district : "";
  const image = ["Type1", "Type3"].includes(it.image_license) ? httpsUrl(it.image) : "";
  return {
    id: `tour-${lang}-${it.id}`, name: { [lang]: title },
    category: "food", district, area: AREA_OF[district] || "", near: [],
    open_hours: null, open_hours_note: "detail_on_request",
    tags: FOOD_TAGS[it.food_type] || [],
    flags: { is_traditional_market: false, is_local_small_business: false, is_night_content: false, is_large_mall_or_duty_free: false },
    address: cleanText(it.addr, 200), lat: Number.isFinite(it.lat) ? it.lat : null, lng: Number.isFinite(it.lng) ? it.lng : null,
    image, image_license: image ? it.image_license : "",
    source: TOUR_SOURCE, is_sample: false, original_lang: lang, needs_translation: translated,
    detail_ref: `tour-${lang}-${it.id}`,
  };
}

/**
 * 사용자 언어 서비스 원문을 우선 쓰고, 그 언어 목록에 해당 지역 음식점이 없을 때만 국문 목록을 붙인다
 * (needs_translation=true: 모델이 번역하고 '번역'으로 표시).
 */
export function tourPlaces(tourFood, lang, district) {
  const langs = tourFood && typeof tourFood === "object" && tourFood.languages && typeof tourFood.languages === "object" ? tourFood.languages : {};
  const list = (l) => (Array.isArray(langs[l] && langs[l].items) ? langs[l].items : []);
  const own = list(lang).map((it) => toPlace(it, lang, false)).filter(Boolean);
  if (lang === "ko") return own;
  const hasLocal = district ? own.some((p) => p.district === district) : own.length > 0;
  if (hasLocal) return own;
  return own.concat(list("ko").map((it) => toPlace(it, "ko", true)).filter(Boolean));
}

export async function loadTourFood(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error(`tour food HTTP ${res.status}`);
  const json = await res.json();
  if (!json || typeof json.languages !== "object") throw new Error("tour food invalid");
  return json;
}

const DETAIL_FIELDS = { opentimefood: "hours", restdatefood: "closed_days", firstmenu: "signature_menu", treatmenu: "menu",
  reservationfood: "reservation", packing: "takeout", parkingfood: "parking", smoking: "smoking", kidsfacility: "kids_facility" };
const detailCache = new Map();
const DETAIL_TTL_MS = 6 * 3600e3;

/** get_restaurant_detail: detailIntro2를 요청 시 조회. 실패·XML 응답은 원문 없이 오류로. */
export async function fetchRestaurantDetail(ref, key, fetchImpl = fetch, now = Date.now()) {
  const m = /^tour-(ko|en|ja|zh-CN|zh-TW)-(\d{1,12})$/.exec(String(ref || ""));
  if (!m) return { ok: false, error: "invalid_id" };
  if (!key) return { ok: false, error: "detail_unavailable" };
  const [, lang, id] = m;
  const cached = detailCache.get(ref);
  if (cached && now - cached.at < DETAIL_TTL_MS) return cached.value;
  const svc = tourCfg.services[lang];
  const params = new URLSearchParams({ serviceKey: key, MobileOS: "ETC", MobileApp: tourCfg.mobile_app, _type: "json",
    contentId: id, contentTypeId: String(svc.food_content_type) });   // URLSearchParams가 한 번만 인코딩
  const url = `${tourCfg.base_url}/${svc.service}/detailIntro2?${params}`;
  if (!url.startsWith("https://")) return { ok: false, error: "detail_unavailable" };
  let text;
  try {
    const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return { ok: false, error: "detail_unavailable" };
    text = (await res.text()).trimStart();
  } catch { return { ok: false, error: "detail_unavailable" }; }
  if (!text.startsWith("{")) return { ok: false, error: "detail_unavailable" };   // XML 오류 응답: 원문 미노출
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: "detail_unavailable" }; }
  const resp = data && data.response;
  if (!resp || !resp.header || resp.header.resultCode !== "0000") return { ok: false, error: "detail_unavailable" };
  let item = resp.body && resp.body.items && resp.body.items.item;
  if (Array.isArray(item)) item = item[0];
  if (!item || typeof item !== "object") return { ok: false, error: "not_found" };
  const detail = {};
  for (const [k, out] of Object.entries(DETAIL_FIELDS)) { const v = cleanText(item[k], 300); if (v) detail[out] = v; }
  const value = { ok: true, result: { id: ref, source: TOUR_SOURCE, is_sample: false, original_lang: lang, detail } };
  detailCache.set(ref, { at: now, value });
  if (detailCache.size > 500) detailCache.delete(detailCache.keys().next().value);
  return value;
}
