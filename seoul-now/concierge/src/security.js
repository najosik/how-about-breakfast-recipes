// 보안 계층: 입력 검증, 개인정보 마스킹, 인젝션 탐지(기록용), 출력 필터, 레이트리밋, 안전 로그.
// §10 개인정보보호법(최소수집) · OWASP Top 10 · OWASP LLM Top 10 대응.

export const LIMITS = {
  maxMessageChars: 1000,      // A04: 입력 길이 제한
  maxTurns: 20,               // 대화 이력 최대 메시지 수(세션 메모리는 브라우저에만)
  maxBodyBytes: 32 * 1024,
  perSessionPerMinute: 10,    // A04: 세션당 분당 10회
  perIpPerMinute: 30,         // 세션 ID를 바꿔 우회하는 경우 대비
};
export const LANGS = ["ko", "en", "ja", "zh-CN", "zh-TW"];

export class InputError extends Error {}

/** 요청 본문 검증. 통과하면 정규화된 값, 아니면 InputError(메시지는 사용자에게 보여도 되는 일반 문구). */
export function validateChatBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("invalid_body");
  const { messages, lang, handoff, region } = body;
  const out = {
    lang: LANGS.includes(lang) ? lang : null,
    handoff: handoff === true,
    region: typeof region === "string" ? region.slice(0, 50) : "",
    messages: [],
  };
  if (out.handoff && (messages === undefined || (Array.isArray(messages) && messages.length === 0))) return out;
  if (!Array.isArray(messages) || messages.length === 0) throw new InputError("invalid_messages");
  const recent = messages.slice(-LIMITS.maxTurns);
  for (const m of recent) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") throw new InputError("invalid_messages");
    const text = m.content.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
    if (!text) throw new InputError("empty_message");
    if (text.length > LIMITS.maxMessageChars) throw new InputError("message_too_long");
    out.messages.push({ role: m.role, content: text });
  }
  // API 형식: 첫 메시지는 user, 마지막도 user
  while (out.messages.length && out.messages[0].role !== "user") out.messages.shift();
  if (!out.messages.length || out.messages[out.messages.length - 1].role !== "user") throw new InputError("invalid_messages");
  return out;
}

// 개인정보 패턴(전달 전 마스킹). 순서 중요: 카드 → 여권 → 전화 → 이메일.
const PII = [
  ["email", /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}/g],
  ["card", /\b(?:\d[ -]?){13,16}\b/g],
  ["passport", /\b[A-Z]{1,2}\d{7,8}\b/g],
  ["rrn", /\b\d{6}[- ]?[1-8]\d{6}\b/g],                         // 주민등록번호·외국인등록번호
  ["phone", /(?:\+?\d{1,3}[ -]?)?(?:\(?0?\d{1,3}\)?[ -]?)\d{3,4}[ -]?\d{4}\b/g],
];
const MASK = { email: "[이메일]", card: "[카드번호]", passport: "[여권번호]", rrn: "[등록번호]", phone: "[전화번호]" };

/** 개인정보를 마스킹. 어떤 종류가 있었는지만 반환(원문은 남기지 않음). */
export function maskPII(text) {
  let out = text;
  const found = new Set();
  for (const [kind, re] of PII) {
    out = out.replace(re, (m) => {
      // 전화 패턴이 날짜·시간·가격 같은 짧은 숫자를 잡지 않도록 숫자 9자리 이상만 마스킹
      if (kind === "phone" && m.replace(/\D/g, "").length < 9) return m;
      found.add(kind);
      return MASK[kind];
    });
  }
  return { text: out, found: [...found] };
}

const INJECTION = [
  /ignore (all |any )?(previous|prior|above) (instructions|prompts?)/i,
  /(reveal|print|show|repeat|output).{0,30}(system prompt|instructions|your rules|tool definitions)/i,
  /system prompt/i, /developer mode|jailbreak|DAN mode/i,
  /이전\s*지시.{0,10}(무시|잊)/, /시스템\s*프롬프트/, /지침.{0,10}(출력|보여|공개)/,
  /システムプロンプト|以前の指示を無視/, /系统提示|系統提示|忽略(之前|以上)的?指令/,
];

/** 인젝션 의심 여부(A09 보안 이벤트 기록용). 차단은 시스템 프롬프트 규칙과 출력 필터가 담당. */
export function looksLikeInjection(text) {
  return INJECTION.some((re) => re.test(text));
}

const EMERGENCY = /(응급|구급차|사고가 났|다쳤|불이 났|화재|경찰|강도|성폭력|도와주세요|emergency|ambulance|injured|accident|fire|police|robbed|assault|help me|救急|事故|火事|警察|急救|救护车|救護車|报警|報警|着火)/i;
export function looksLikeEmergency(text) {
  return EMERGENCY.test(text);
}

/**
 * 출력 필터(LLM02): 응답에 시스템 프롬프트 표식(canary)·API 키 형태·내부 설정 문구가 있으면 응답 전체를 대체.
 * @returns {{ text: string, blocked: boolean }}
 */
export function filterOutput(text, canary) {
  const s = typeof text === "string" ? text : "";
  const leaked = (canary && s.includes(canary)) ||
    /sk-ant-[A-Za-z0-9_-]{10,}/.test(s) ||
    /ANTHROPIC_API_KEY|CLAUDE_MODEL|ranking\.json|input_schema/.test(s);
  return leaked ? { text: "", blocked: true } : { text: s.slice(0, 6000), blocked: false };
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * KV 고정 창 레이트리밋. IP·세션 ID는 해시만 키로 쓰고 2분 뒤 자동 삭제(원문 저장 안 함).
 * KV는 원자적 증가가 없어 근사치이며, 시연용으로 충분하다.
 */
export async function checkRateLimit(kv, { ip, sessionId, now = Date.now(), salt = "" }) {
  if (!kv) return { ok: true, reason: "no_kv" };
  const minute = Math.floor(now / 60000);
  const checks = [
    [`rl:s:${await sha256Hex(salt + "s" + (sessionId || "none"))}:${minute}`, LIMITS.perSessionPerMinute],
    [`rl:i:${await sha256Hex(salt + "i" + (ip || "unknown"))}:${minute}`, LIMITS.perIpPerMinute],
  ];
  for (const [key, limit] of checks) {
    const n = parseInt((await kv.get(key)) || "0", 10);
    if (n >= limit) return { ok: false, reason: key.startsWith("rl:s") ? "session" : "ip" };
  }
  for (const [key] of checks) {
    const n = parseInt((await kv.get(key)) || "0", 10);
    await kv.put(key, String(n + 1), { expirationTtl: 120 });
  }
  return { ok: true };
}

/** 안전 로그(A09): 메시지 원문 없이 길이·언어·도구명·이벤트만. */
export function safeLog(event, fields = {}) {
  const allowed = ["len", "lang", "tools", "ms", "stop", "pii", "reason", "status", "turns", "fallback"];
  const rec = { event };
  for (const k of allowed) if (fields[k] !== undefined) rec[k] = fields[k];
  console.log(JSON.stringify(rec));
}

/** 사용자 언어 감지(문자 체계 기반). UI 드롭다운 값이 있으면 그것을 우선. */
export function detectLang(text) {
  const s = String(text || "");
  if (/[぀-ヿ]/.test(s)) return "ja";
  if (/[가-힣]/.test(s)) return "ko";
  if (/[一-鿿]/.test(s)) return /[這們說國時買還麼讓對點樣與為會個來]/.test(s) ? "zh-TW" : "zh-CN";
  return "en";
}
