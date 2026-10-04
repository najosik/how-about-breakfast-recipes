// claude.ai 아티팩트용 엔진: API 키 없이, 보는 사람의 Claude 계정으로 호출(`sample` 기능).
// 축제 어댑터·rankPlaces·도구·보안 모듈은 Worker 버전과 같은 코드를 그대로 쓰고, Claude 호출 부분만 바꾼다.
// 페이지는 외부 네트워크를 쓸 수 없으므로 축제 데이터는 빌드 시점의 events.json 스냅샷을 포함한다.
import places from "../src/data/places.json" with { type: "json" };
import transit from "../src/data/transit.json" with { type: "json" };
import dsp from "../src/data/dsp_products.json" with { type: "json" };
import centers from "../src/data/info_centers.json" with { type: "json" };
import ranking from "../src/config/ranking.json" with { type: "json" };
import eventsSnapshot from "../../data/events.json" with { type: "json" };
import { kstToday } from "../src/festivals.js";
import { TOOL_DEFINITIONS, executeTool, cardsFromResult, findInfoCenter } from "../src/tools.js";
import { systemPrompt, languageNote, CANARY } from "../src/prompt.js";
import { msg } from "../src/messages.js";
import { dedupeCards } from "../src/cards.js";
import { validateChatBody, InputError, maskPII, looksLikeEmergency, filterOutput, detectLang } from "../src/security.js";

const MAX_TOOL_CALLS = 5;   // 요청당 도구 호출 상한(LLM10)

const TOOL_LABEL = {
  ko: { search_festivals: "축제 정보 확인 중", search_places: "장소 찾는 중", get_transit_guide: "교통 안내 확인 중", recommend_dsp: "패스 상품 확인 중", find_info_center: "관광정보센터 찾는 중" },
  en: { search_festivals: "checking festivals", search_places: "finding places", get_transit_guide: "checking transport", recommend_dsp: "checking passes", find_info_center: "finding an info center" },
  ja: { search_festivals: "お祭りを確認中", search_places: "スポットを検索中", get_transit_guide: "交通を確認中", recommend_dsp: "パスを確認中", find_info_center: "観光案内所を検索中" },
  "zh-CN": { search_festivals: "正在查询节庆", search_places: "正在查找地点", get_transit_guide: "正在查询交通", recommend_dsp: "正在查询通票", find_info_center: "正在查找咨询中心" },
  "zh-TW": { search_festivals: "正在查詢節慶", search_places: "正在尋找地點", get_transit_guide: "正在查詢交通", recommend_dsp: "正在查詢通行證", find_info_center: "正在尋找諮詢中心" },
};
const UNAVAILABLE = {
  ko: "이 화면에서는 Claude 연결을 사용할 수 없습니다(동의하지 않았거나 조직 설정으로 꺼져 있음). 상담원 연결 버튼은 사용할 수 있습니다.",
  en: "Claude isn't available on this page (not allowed, or turned off by your organization). The 'Talk to a person' button still works.",
  ja: "このページではClaudeを利用できません（未許可、または組織の設定で無効）。「スタッフにつなぐ」ボタンは利用できます。",
  "zh-CN": "此页面无法使用 Claude（未允许或已被组织关闭）。“转接人工”按钮仍可使用。",
  "zh-TW": "此頁面無法使用 Claude（未允許或已被組織關閉）。「轉接真人」按鈕仍可使用。",
};
const DATA_NOTE = {
  ko: (d) => `축제 정보는 서울시 문화행사 정보 API 데이터(${d} 기준)입니다. 그 밖의 장소·교통·패스 정보는 샘플입니다.`,
  en: (d) => `Festival info is Seoul culture-event API data as of ${d}. Other places, transport and passes are sample data.`,
  ja: (d) => `お祭り情報はソウル市文化行事APIのデータ（${d}時点）です。その他のスポット・交通・パスはサンプルです。`,
  "zh-CN": (d) => `节庆信息来自首尔市文化活动 API（截至 ${d}）。其他地点、交通和通票为示例数据。`,
  "zh-TW": (d) => `節慶資訊來自首爾市文化活動 API（截至 ${d}）。其他地點、交通與通行證為範例資料。`,
};
const L = (table, lang) => table[lang] || table.en;

let samplePromise = null;
function getSample() {
  if (!samplePromise) {
    samplePromise = window.claude && typeof window.claude.use === "function"
      ? window.claude.use("sample").catch(() => null) : Promise.resolve(null);
  }
  return samplePromise;
}
getSample();   // 미리 준비(동의 창은 첫 질문 때만 뜬다)

const feedDate = String(eventsSnapshot.updatedAt || "").slice(0, 16).replace("T", " ");

async function chat(payload, { onProgress } = {}) {
  let input;
  try {
    input = validateChatBody(payload);
  } catch (e) {
    const lang = payload && typeof payload.lang === "string" ? payload.lang : "en";
    if (e instanceof InputError) throw new Error(e.message === "message_too_long" ? msg(lang, "too_long") : msg(lang, "error"));
    throw e;
  }
  const lastUser = input.messages.length ? input.messages[input.messages.length - 1].content : "";
  const lang = input.lang || detectLang(lastUser);

  // F4 상담원 연결 버튼: Claude 호출 없이 코드로 바로
  if (input.handoff) {
    return { reply: "", lang, notices: [], cards: cardsFromResult("find_info_center", findInfoCenter({ area: input.region }, centers)) };
  }

  const notices = looksLikeEmergency(lastUser) ? [{ type: "emergency", text: msg(lang, "emergency") }] : [];
  const sample = await getSample();
  if (!sample) throw new Error(L(UNAVAILABLE, lang));
  const limits = await sample.limits().catch(() => null);
  if (!limits || !limits.tools) throw new Error(L(UNAVAILABLE, lang));

  // 개인정보 마스킹 후 전달. 지침은 맨 앞 user 턴, 언어 지시는 마지막 user 턴 끝에.
  const today = kstToday();
  const turns = [{ role: "user", content: `${systemPrompt(today)}\n\n(Operator instructions above. The visitor's messages follow.)` }];
  input.messages.forEach((m, i) => {
    const content = m.role === "user" ? maskPII(m.content).text : m.content;
    const last = i === input.messages.length - 1;
    turns.push({ role: m.role, content: last ? `${content}\n\n[Language note: ${languageNote(lang)}]` : content });
  });

  const cards = [];
  const used = [];
  let calls = 0;
  const ctx = { today, lang, places, transit, dsp, centers, ranking, getFeed: async () => eventsSnapshot };
  const tools = TOOL_DEFINITIONS.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.input_schema,
    async execute(args) {
      if (++calls > MAX_TOOL_CALLS) throw new Error("tool_call_limit: answer with the information you already have");
      used.push(def.name);
      if (onProgress) onProgress(L(TOOL_LABEL, lang)[def.name]);
      const { ok, result } = await executeTool(def.name, args, ctx);
      if (!ok) throw new Error("data unavailable: tell the visitor it is unconfirmed");
      cards.push(...cardsFromResult(def.name, result));
      return result;
    },
  }));

  let text = "";
  try {
    ({ text } = await sample(turns, { tools, modelTier: "default" }));
  } catch (e) {
    const code = e && e.code;
    if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed", "tools_unavailable"].includes(code)) {
      throw new Error(L(UNAVAILABLE, lang));
    }
    if (code === "rate_limited") throw new Error(msg(lang, "rate"));
    if (code === "refused") return { reply: msg(lang, "blocked"), lang, cards: [], notices };
    throw new Error(msg(lang, "error"));
  }

  const filtered = filterOutput(text, CANARY);
  return {
    reply: filtered.blocked ? msg(lang, "blocked") : (filtered.text || msg(lang, "error")),
    lang, notices,
    cards: dedupeCards(cards).slice(0, 20),
    ranking_note: used.includes("search_places") ? (ranking.transparency_note[lang] || ranking.transparency_note.en) : "",
  };
}

window.ConciergeBackend = Object.freeze({
  mode: "artifact",
  noImages: true,   // 아티팩트는 외부 이미지를 불러올 수 없음
  chat,
  product: (id) => dsp.find((p) => p.id === id) || null,
  dataNote: (lang) => L(DATA_NOTE, lang)(feedDate),
});
