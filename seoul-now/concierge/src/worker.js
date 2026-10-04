// 서울 AI 관광 컨시어지 — Cloudflare Worker (/api/chat). 내부 시연용, 실제 결제 없음.
//
// 필요한 설정(Cloudflare 대시보드 → Worker → Settings):
//   Secret  ANTHROPIC_API_KEY   Claude API 키(코드·저장소에 두지 않음)
//   Var     ALLOWED_ORIGIN      예: https://how-about-breakfast.com
//   Var     CLAUDE_MODEL        (선택) 기본 claude-sonnet-5-5
//   Var     EVENTS_URL          (선택) 기존 축제 모듈 산출물 events.json 주소
//   Var     RL_SALT             (선택) 레이트리밋 키 해시용 임의 문자열
//   KV      RATE_KV             레이트리밋 카운터(2분 뒤 자동 삭제)
//   + Cloudflare Access로 직원 이메일만 접근 허용(README 참고)
import Anthropic from "@anthropic-ai/sdk";
import places from "./data/places.json" with { type: "json" };
import transit from "./data/transit.json" with { type: "json" };
import dsp from "./data/dsp_products.json" with { type: "json" };
import centers from "./data/info_centers.json" with { type: "json" };
import ranking from "./config/ranking.json" with { type: "json" };
import { loadFeed, kstToday } from "./festivals.js";
import { TOOL_DEFINITIONS, executeTool, cardsFromResult, findInfoCenter } from "./tools.js";
import { systemPrompt, languageNote, CANARY } from "./prompt.js";
import {
  validateChatBody, InputError, maskPII, looksLikeInjection, looksLikeEmergency, filterOutput,
  checkRateLimit, safeLog, detectLang, LIMITS,
} from "./security.js";

const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_EVENTS_URL = "https://how-about-breakfast.com/seoul-now/data/events.json";
const MAX_TOOL_CALLS = 5;      // LLM10: 요청당 도구 호출 상한
const MAX_API_CALLS = 6;       // 도구 루프 상한
const MAX_TOKENS = 2000;       // LLM10: 응답 길이 상한(휴대폰 화면용 짧은 답변)

const MSG = {
  ko: { error: "일시적으로 답변할 수 없습니다. 잠시 후 다시 시도하거나 관광통역안내 1330으로 문의해 주세요.",
    rate: "요청이 너무 많습니다. 1분 뒤 다시 시도해 주세요.", blocked: "그 요청에는 답할 수 없습니다. 여행 관련 질문을 도와드릴게요.",
    emergency: "긴급 상황이면 112(경찰), 119(화재·구급), 1330(관광통역안내)으로 바로 연락하세요.", too_long: "메시지는 1,000자 이내로 입력해 주세요." },
  en: { error: "Sorry, I can't answer right now. Please try again shortly or call the 1330 Korea Travel Hotline.",
    rate: "Too many requests. Please try again in a minute.", blocked: "I can't help with that request, but I'm happy to help with your trip.",
    emergency: "In an emergency call 112 (police), 119 (fire/ambulance) or 1330 (interpretation) right away.", too_long: "Please keep messages under 1,000 characters." },
  ja: { error: "現在お答えできません。しばらくしてから再度お試しいただくか、観光通訳案内1330へお問い合わせください。",
    rate: "リクエストが多すぎます。1分後にもう一度お試しください。", blocked: "そのご依頼にはお答えできません。旅行のご質問ならお手伝いします。",
    emergency: "緊急時は112（警察）、119（消防・救急）、1330（通訳案内）へすぐにご連絡ください。", too_long: "メッセージは1,000文字以内で入力してください。" },
  "zh-CN": { error: "暂时无法回答。请稍后再试，或拨打旅游翻译热线1330。", rate: "请求过多，请一分钟后再试。",
    blocked: "无法回答该请求。我可以帮您解答旅行相关问题。", emergency: "如遇紧急情况，请立即拨打112（警察）、119（消防/急救）或1330（翻译）。", too_long: "消息请控制在1000字以内。" },
  "zh-TW": { error: "暫時無法回答。請稍後再試，或撥打觀光翻譯熱線1330。", rate: "請求過多，請一分鐘後再試。",
    blocked: "無法回答該請求。我可以協助您解答旅遊相關問題。", emergency: "如遇緊急狀況，請立即撥打112（警察）、119（消防/救護）或1330（翻譯）。", too_long: "訊息請控制在1000字以內。" },
};
const msg = (lang, key) => (MSG[lang] || MSG.en)[key];

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
  const ctx = {
    today, lang, places, transit, dsp, centers, ranking,
    getFeed: () => (feedPromise ||= (deps.loadFeed || loadFeed)(env.EVENTS_URL || DEFAULT_EVENTS_URL)),
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

function dedupeCards(cards) {
  const seen = new Set();
  return cards.filter((c) => {
    const k = `${c.type}:${c.data && c.data.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const headers = securityHeaders(cors(env, origin));

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname !== "/api/chat") return json(404, { error: "not_found" }, headers);
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, headers);
    if (origin && origin !== (env.ALLOWED_ORIGIN || "https://how-about-breakfast.com")) return json(403, { error: "forbidden" }, headers);
    if (!(request.headers.get("Content-Type") || "").includes("application/json")) return json(415, { error: "unsupported_media_type" }, headers);
    if (!env.ANTHROPIC_API_KEY) { safeLog("config_error", { reason: "missing_key" }); return json(503, { error: "unavailable" }, headers); }

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
      const { status, body: out } = await handleChat(body, env);
      return json(status, out, headers);
    } catch {
      safeLog("internal_error", {});
      return json(500, { error: msg("en", "error") }, headers);   // A05: 상세 오류 숨김
    }
  },
};
