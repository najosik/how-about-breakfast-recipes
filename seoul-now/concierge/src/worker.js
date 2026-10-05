// 서울 AI 관광 컨시어지 — Cloudflare Worker (/api/chat). 내부 시연용, 실제 결제 없음.
//
// 필요한 설정(Cloudflare 대시보드 → Worker → Settings):
//   Secret  ANTHROPIC_API_KEY   Claude API 키(코드·저장소에 두지 않음)
//   Var     ALLOWED_ORIGIN      예: https://how-about-breakfast.com
//   Var     CLAUDE_MODEL        (선택) 기본 claude-sonnet-5-5
//   Var     EVENTS_URL          (선택) 기존 축제 모듈 산출물 events.json 주소
//   Var     FIT_BASE_URL        (선택) festival_tags.json·festival_overrides.json 이 있는 경로
//   Secret  TOURAPI_KEY         (선택) 한국관광공사 TourAPI Decoding 키 — 음식점 상세(detailIntro2) 조회용
//   Var     TOUR_FOOD_URL       (선택) tour_food.json 주소(하루 1회 수집본)
//   Var     TRANSIT_URL         (선택) transit_network.json 주소(경로 엔진 노선망)
//   Var     RL_SALT             (선택) 레이트리밋 키 해시용 임의 문자열
//   KV      RATE_KV             레이트리밋 카운터(2분 뒤 자동 삭제)
//   + Cloudflare Access로 직원 이메일만 접근 허용(README 참고)
import Anthropic from "@anthropic-ai/sdk";
import places from "./data/places.json" with { type: "json" };
import dsp from "./data/dsp_products.json" with { type: "json" };
import centers from "./data/info_centers.json" with { type: "json" };
import ranking from "./config/ranking.json" with { type: "json" };
import fitConfig from "./config/festival_fit.json" with { type: "json" };
import { loadFeed, loadFit, kstToday } from "./festivals.js";
import { loadTourFood, fetchRestaurantDetail } from "./restaurants.js";
import { TOOL_DEFINITIONS, executeTool, cardsFromResult, findInfoCenter } from "./tools.js";
import { systemPrompt, languageNote, CANARY } from "./prompt.js";
import { msg } from "./messages.js";
import { dedupeCards } from "./cards.js";
import STATIC from "./static.generated.js";
import {
  validateChatBody, InputError, maskPII, looksLikeInjection, looksLikeEmergency, filterOutput,
  checkRateLimit, safeLog, detectLang, LIMITS,
} from "./security.js";

const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_EVENTS_URL = "https://how-about-breakfast.com/seoul-now/data/events.json";
const DEFAULT_FIT_BASE_URL = "https://how-about-breakfast.com/seoul-now/data/";
const DEFAULT_TRANSIT_URL = "https://how-about-breakfast.com/seoul-now/data/transit_network.json";
const DEFAULT_TOUR_FOOD_URL = "https://how-about-breakfast.com/seoul-now/data/tour_food.json";

// 노선망(약 2MB)은 격리 단위로 1시간 캐시: 요청마다 다시 받지 않는다
let transitCache = { at: 0, url: "", promise: null };
function loadTransitCached(url) {
  const now = Date.now();
  if (!transitCache.promise || transitCache.url !== url || now - transitCache.at > 3600e3) {
    transitCache = { at: now, url, promise: fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } })
      .then((r) => (r.ok ? r.json() : null)).then((j) => (j && (j.bus || j.subway) ? j : null)).catch(() => null) };
  }
  return transitCache.promise;
}
const MAX_TOOL_CALLS = 5;      // LLM10: 요청당 도구 호출 상한
const MAX_API_CALLS = 6;       // 도구 루프 상한
const MAX_TOKENS = 2000;       // LLM10: 응답 길이 상한(휴대폰 화면용 짧은 답변)



/** 기본 Claude 호출: 공식 SDK, 서버측 거절 대체(fallbacks: "default") 사용. 테스트에서는 deps.createMessage로 교체. */
function defaultCreateMessage(env) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45_000 });
  return (params) => client.beta.messages.create({
    ...params,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
}

/**
 * 채팅 처리 본체(HTTP와 분리해 테스트 가능).
 * @returns {Promise<{status:number, body:object}>}
 */
export async function handleChat(rawBody, env, deps = {}) {
  const started = Date.now();
  let input;
  try {
    input = validateChatBody(rawBody);
  } catch (e) {
    const lang = rawBody && typeof rawBody.lang === "string" ? rawBody.lang : "en";
    if (e instanceof InputError) {
      safeLog("input_rejected", { reason: e.message });
      return { status: 400, body: { error: e.message === "message_too_long" ? msg(lang, "too_long") : msg(lang, "error") } };
    }
    throw e;
  }

  const lastUser = input.messages.length ? input.messages[input.messages.length - 1].content : "";
  const lang = input.lang || detectLang(lastUser);

  // F4 상담원 연결 버튼: LLM 없이 코드로 바로 센터 카드 반환(비용 0, 항상 동작)
  if (input.handoff) {
    const r = findInfoCenter({ area: input.region }, centers);
    safeLog("handoff", { lang });
    return { status: 200, body: { reply: "", lang, cards: cardsFromResult("find_info_center", r), notices: [] } };
  }

  const notices = [];
  if (looksLikeEmergency(lastUser)) notices.push({ type: "emergency", text: msg(lang, "emergency") });

  // 개인정보 마스킹 후 LLM 전달
  const piiKinds = new Set();
  const messages = input.messages.map((m) => {
    if (m.role !== "user") return m;
    const { text, found } = maskPII(m.content);
    found.forEach((k) => piiKinds.add(k));
    return { role: "user", content: text };
  });
  if (piiKinds.size) safeLog("pii_masked", { pii: [...piiKinds] });
  if (looksLikeInjection(lastUser)) safeLog("injection_suspected", { len: lastUser.length, lang });
  // 언어 지시: 대화 끝에 운영자 메시지로(캐시된 앞부분을 바꾸지 않음)
  messages.push({ role: "system", content: languageNote(lang) });

  const today = kstToday();
  let feedPromise = null;
  let fitPromise = null;
  let tourPromise = null;
  const fitBase = env.FIT_BASE_URL || DEFAULT_FIT_BASE_URL;
  const ctx = {
    today, lang, places, dsp, centers, ranking,
    getTransit: () => (deps.loadTransit || loadTransitCached)(env.TRANSIT_URL || DEFAULT_TRANSIT_URL),
    getFeed: () => (feedPromise ||= (deps.loadFeed || loadFeed)(env.EVENTS_URL || DEFAULT_EVENTS_URL)),
    getTourFood: () => (tourPromise ||= (deps.loadTourFood || loadTourFood)(env.TOUR_FOOD_URL || DEFAULT_TOUR_FOOD_URL).catch(() => null)),
    getRestaurantDetail: (id) => (deps.fetchRestaurantDetail || fetchRestaurantDetail)(id, env.TOURAPI_KEY),
    getFit: () => (fitPromise ||= deps.loadFit ? deps.loadFit()
      : loadFit(fitConfig, new URL("festival_tags.json", fitBase).href, new URL("festival_overrides.json", fitBase).href)),
  };
  const createMessage = deps.createMessage || defaultCreateMessage(env);
  const model = env.CLAUDE_MODEL || DEFAULT_MODEL;
  const system = [{ type: "text", text: systemPrompt(today), cache_control: { type: "ephemeral" } }];

  const cards = [];
  const toolsUsed = [];
  let toolCalls = 0;
  let response = null;
  let fallback = false;

  try {
    for (let i = 0; i < MAX_API_CALLS; i++) {
      const capped = toolCalls >= MAX_TOOL_CALLS;
      response = await createMessage({
        model, max_tokens: MAX_TOKENS, system, messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: capped ? { type: "none" } : { type: "auto" },
        output_config: { effort: "low" },
      });
      if ((response.content || []).some((b) => b.type === "fallback")) fallback = true;
      if (response.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: response.content });   // 블록 그대로(사고 블록 포함) 되돌려 보냄
      const results = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        if (toolCalls >= MAX_TOOL_CALLS) {
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true,
            content: JSON.stringify({ error: "tool_call_limit", message: "Answer with the information you already have." }) });
          continue;
        }
        toolCalls++;
        toolsUsed.push(block.name);
        const { ok, result } = await executeTool(block.name, block.input, ctx);
        if (ok) cards.push(...cardsFromResult(block.name, result));
        results.push({ type: "tool_result", tool_use_id: block.id, is_error: !ok, content: JSON.stringify(result) });
      }
      messages.push({ role: "user", content: results });   // 병렬 호출 결과는 한 메시지에 모두
    }
  } catch (e) {
    safeLog("claude_error", { status: e && e.status, tools: toolsUsed, ms: Date.now() - started });
    return { status: 502, body: { error: msg(lang, "error"), lang } };
  }

  let reply = "";
  if (response && response.stop_reason === "refusal") {
    reply = msg(lang, "blocked");
  } else {
    const text = (response?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    const filtered = filterOutput(text, CANARY);
    if (filtered.blocked) safeLog("output_blocked", { lang });
    reply = filtered.blocked ? msg(lang, "blocked") : filtered.text;
    if (!reply) reply = msg(lang, "error");
  }

  safeLog("chat", { len: lastUser.length, lang, tools: toolsUsed, ms: Date.now() - started,
    stop: response?.stop_reason, turns: input.messages.length, fallback });
  return { status: 200, body: { reply, lang, cards: dedupeCards(cards).slice(0, 20), notices,
    ranking_note: toolsUsed.includes("search_places") ? (ranking.transparency_note[lang] || ranking.transparency_note.en) : "" } };
}

// ---------------------------------------------------------------- HTTP
function securityHeaders(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    ...extra,
  };
}

function cors(env, origin) {
  const allowed = env.ALLOWED_ORIGIN || "https://how-about-breakfast.com";
  return origin === allowed
    ? { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Session-Id", "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "600", Vary: "Origin" }
    : { Vary: "Origin" };
}

const json = (status, body, headers) => new Response(JSON.stringify(body), { status, headers });

// 화면(정적 파일)도 같은 Worker가 제공: Cloudflare Access 한 번으로 화면·API 모두 직원 전용, 샘플 데이터는 공개 경로에 없음(A01).
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; " +
  "font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const STATIC_TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

function serveStatic(pathname) {
  const path = pathname === "/" ? "/index.html" : pathname;
  if (!Object.hasOwn(STATIC, path)) return null;
  const ext = path.slice(path.lastIndexOf("."));
  return new Response(STATIC[path], { status: 200, headers: {
    "Content-Type": STATIC_TYPES[ext] || "application/octet-stream",
    "Content-Security-Policy": PAGE_CSP, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY", "Cache-Control": "no-cache",
    "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=()",   // §10: 정확한 위치 수집 안 함
  } });
}

/** deps로 Claude 호출·축제 피드를 바꿔 끼울 수 있는 핸들러(테스트·로컬 개발용). */
export function makeHandler(deps = {}) {
  return async function fetchHandler(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = (o) => o === url.origin || o === env.ALLOWED_ORIGIN;
    const headers = securityHeaders(allowedOrigin(origin) && origin !== url.origin ? cors(env, origin) : { Vary: "Origin" });

    // 목업 결제 화면용 DSP 상품 1건 조회(읽기 전용, 샘플 표시). 전체 목록은 노출하지 않는다.
    const dspMatch = url.pathname.match(/^\/api\/dsp\/([a-z0-9-]{1,30})$/);
    if (request.method === "GET" && dspMatch) {
      const p = dsp.find((x) => x.id === dspMatch[1]);
      return p ? json(200, { product: p, demo: true }, headers) : json(404, { error: "not_found" }, headers);
    }
    if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
      return serveStatic(url.pathname) || json(404, { error: "not_found" }, headers);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname !== "/api/chat") return json(404, { error: "not_found" }, headers);
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, headers);
    if (origin && !allowedOrigin(origin)) return json(403, { error: "forbidden" }, headers);
    if (!(request.headers.get("Content-Type") || "").includes("application/json")) return json(415, { error: "unsupported_media_type" }, headers);
    if (!env.ANTHROPIC_API_KEY && !deps.createMessage) { safeLog("config_error", { reason: "missing_key" }); return json(503, { error: "unavailable" }, headers); }

    const sessionId = (request.headers.get("X-Session-Id") || "").slice(0, 64);
    const rl = await checkRateLimit(env.RATE_KV, { ip: request.headers.get("CF-Connecting-IP"), sessionId, salt: env.RL_SALT || "" });
    if (!rl.ok) {
      safeLog("rate_limited", { reason: rl.reason });
      return json(429, { error: msg("en", "rate") }, { ...headers, "Retry-After": "60" });
    }

    const raw = await request.text();
    if (raw.length > LIMITS.maxBodyBytes) return json(413, { error: "too_large" }, headers);
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, { error: "invalid_json" }, headers); }

    try {
      const { status, body: out } = await handleChat(body, env, deps);
      return json(status, out, headers);
    } catch {
      safeLog("internal_error", {});
      return json(500, { error: msg("en", "error") }, headers);   // A05: 상세 오류 숨김
    }
  };
}

export default { fetch: makeHandler() };
