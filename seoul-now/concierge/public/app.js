// 서울 AI 컨시어지 채팅 UI (내부 시연용).
// 보안: LLM 출력은 신뢰하지 않는 입력(A03). innerHTML을 쓰지 않고 textContent + 허용된 마크다운(**굵게**, - 목록)만 DOM으로 만든다.
// 개인정보: 대화는 이 페이지의 메모리에만 있고 저장하지 않는다(새로고침하면 사라짐).
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const LANGS = ["ko", "en", "ja", "zh-CN", "zh-TW"];
  const T = {
    ko: { banner: "서울관광재단 내부 시연용 프로토타입 · 실제 결제·예약 없음", send: "보내기", placeholder: "무엇이든 물어보세요 (교통·음식·쇼핑·축제)",
      handoff: "상담원 연결 (관광정보센터)", privacy: "이름·연락처·여권번호는 입력하지 마세요. 대화는 저장되지 않습니다.",
      welcome: "안녕하세요! 서울 여행의 교통·음식·쇼핑·축제를 한 번에 안내해 드려요.", typing: "답변을 준비하고 있어요…",
      real: "실데이터", sample: "샘플 데이터", local: "지역 상권", buy: "구매하기 (시연)", official: "공식 페이지", call: "1330 전화",
      error: "연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.", sendLabel: "메시지 보내기", langLabel: "언어 선택",
      kinds: { festival: "축제·행사", place: "추천 장소", transit: "교통 안내", dsp: "디스커버 서울 패스", center: "관광정보센터" },
      hours: "운영", price: "가격(샘플)", free: "무료", ongoing: "진행 중", minutes: (m) => `약 ${m}분`, handoffMsg: "가까운 관광정보센터를 안내해 드릴게요. 직원과 직접 상담할 수 있어요.",
      langs: { ko: "한국어", en: "영어", ja: "일본어", zh: "중국어" }, hotline: "관광통역안내 1330: 24시간, 다국어 상담" },
    en: { banner: "Seoul Tourism Organization internal demo · No real payments or bookings", send: "Send", placeholder: "Ask about transport, food, shopping, festivals",
      handoff: "Talk to a person (Tourist Information Center)", privacy: "Please don't enter names, phone numbers or passport numbers. Chats are not saved.",
      welcome: "Hello! I can help with transport, food, shopping and festivals in Seoul — all in one answer.", typing: "Preparing your answer…",
      real: "Real data", sample: "Sample data", local: "Local business", buy: "Buy (demo)", official: "Official page", call: "Call 1330",
      error: "Connection problem. Please try again shortly.", sendLabel: "Send message", langLabel: "Language",
      kinds: { festival: "Festival / event", place: "Recommended place", transit: "Getting there", dsp: "Discover Seoul Pass", center: "Tourist info center" },
      hours: "Hours", price: "Price (sample)", free: "Free", ongoing: "On now", minutes: (m) => `about ${m} min`, handoffMsg: "Here is the nearest tourist information center, where staff can help you in person.",
      langs: { ko: "Korean", en: "English", ja: "Japanese", zh: "Chinese" }, hotline: "Korea Travel Hotline 1330: 24/7, multilingual" },
    ja: { banner: "ソウル観光財団 社内デモ用プロトタイプ・実際の決済や予約は行いません", send: "送信", placeholder: "交通・グルメ・ショッピング・お祭りについて質問",
      handoff: "スタッフにつなぐ（観光案内所）", privacy: "氏名・電話番号・パスポート番号は入力しないでください。会話は保存されません。",
      welcome: "こんにちは！ソウルの交通・グルメ・ショッピング・お祭りをまとめてご案内します。", typing: "回答を準備しています…",
      real: "実データ", sample: "サンプル", local: "地域の商店", buy: "購入（デモ）", official: "公式ページ", call: "1330に電話",
      error: "接続に問題があります。しばらくしてからお試しください。", sendLabel: "メッセージを送信", langLabel: "言語",
      kinds: { festival: "お祭り・イベント", place: "おすすめスポット", transit: "アクセス", dsp: "ディスカバーソウルパス", center: "観光案内所" },
      hours: "営業", price: "価格（サンプル）", free: "無料", ongoing: "開催中", minutes: (m) => `約${m}分`, handoffMsg: "最寄りの観光案内所です。スタッフが直接ご案内します。",
      langs: { ko: "韓国語", en: "英語", ja: "日本語", zh: "中国語" }, hotline: "観光通訳案内1330：24時間・多言語対応" },
    "zh-CN": { banner: "首尔旅游财团内部演示原型 · 不进行真实支付或预订", send: "发送", placeholder: "询问交通、美食、购物、节庆",
      handoff: "转接人工（旅游咨询中心）", privacy: "请勿输入姓名、电话或护照号码。对话不会被保存。",
      welcome: "您好！我可以一次性为您介绍首尔的交通、美食、购物和节庆。", typing: "正在准备回答…",
      real: "真实数据", sample: "示例数据", local: "本地商家", buy: "购买（演示）", official: "官方页面", call: "拨打1330",
      error: "连接出现问题，请稍后再试。", sendLabel: "发送消息", langLabel: "语言",
      kinds: { festival: "节庆·活动", place: "推荐地点", transit: "交通指南", dsp: "首尔通票", center: "旅游咨询中心" },
      hours: "营业", price: "价格（示例）", free: "免费", ongoing: "进行中", minutes: (m) => `约${m}分钟`, handoffMsg: "为您推荐最近的旅游咨询中心，工作人员可当面为您服务。",
      langs: { ko: "韩语", en: "英语", ja: "日语", zh: "中文" }, hotline: "旅游翻译热线1330：24小时多语种服务" },
    "zh-TW": { banner: "首爾觀光財團內部展示原型 · 不進行實際付款或預訂", send: "傳送", placeholder: "詢問交通、美食、購物、節慶",
      handoff: "轉接真人（觀光諮詢中心）", privacy: "請勿輸入姓名、電話或護照號碼。對話不會被儲存。",
      welcome: "您好！我可以一次為您介紹首爾的交通、美食、購物與節慶。", typing: "正在準備回答…",
      real: "真實資料", sample: "範例資料", local: "在地商家", buy: "購買（展示）", official: "官方頁面", call: "撥打1330",
      error: "連線發生問題，請稍後再試。", sendLabel: "傳送訊息", langLabel: "語言",
      kinds: { festival: "節慶·活動", place: "推薦地點", transit: "交通指南", dsp: "首爾通行證", center: "觀光諮詢中心" },
      hours: "營業", price: "價格（範例）", free: "免費", ongoing: "進行中", minutes: (m) => `約${m}分鐘`, handoffMsg: "為您介紹最近的觀光諮詢中心，工作人員可當面為您服務。",
      langs: { ko: "韓語", en: "英語", ja: "日語", zh: "中文" }, hotline: "觀光翻譯熱線1330：24小時多語服務" },
  };
  // 시연 시나리오(§3) 바로가기
  const SUGGESTIONS = [
    "I'm near Myeongdong tonight. Where can I eat, how do I get to a night market, and any festivals this week?",
    "東京から来ました。ショッピングがしたいです。",
    "3일 동안 궁이랑 전망대 가고 싶어요.",
    "我想和真人说话，我的包丢了。",
  ];

  const state = { lang: "auto", uiLang: detectUiLang(), messages: [], busy: false, sessionId: randomId() };

  function randomId() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function detectUiLang() {
    const n = (navigator.language || "en").toLowerCase();
    if (n.startsWith("ko")) return "ko";
    if (n.startsWith("ja")) return "ja";
    if (n === "zh-tw" || n === "zh-hk" || n.startsWith("zh-hant")) return "zh-TW";
    if (n.startsWith("zh")) return "zh-CN";
    return "en";
  }
  const t = (k) => (T[state.uiLang] || T.en)[k];

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of kids) if (c != null && c !== false) n.append(c);
    return n;
  }
  const safeUrl = (u) => {
    try { const p = new URL(u, location.origin); return ["https:", "http:"].includes(p.protocol) ? p.href : ""; } catch { return ""; }
  };
  const sameOriginPath = (u) => {
    try { const p = new URL(u, location.origin); return p.origin === location.origin ? p.pathname + p.search : ""; } catch { return ""; }
  };

  // ---------- 허용된 마크다운만: 문단, "- " 목록, **굵게** ----------
  function inline(text) {
    const frag = document.createDocumentFragment();
    String(text).split(/(\*\*[^*\n]{1,200}\*\*)/g).forEach((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) frag.append(el("strong", { text: part.slice(2, -2) }));
      else if (part) frag.append(document.createTextNode(part));
    });
    return frag;
  }
  function renderText(text) {
    const box = document.createDocumentFragment();
    let list = null;
    for (const raw of String(text).split("\n")) {
      const line = raw.replace(/^#{1,6}\s+/, "").trimEnd();
      const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (m) { if (!list) { list = el("ul"); box.append(list); } list.append(el("li", {}, inline(m[1]))); continue; }
      list = null;
      if (line.trim()) box.append(el("p", {}, inline(line)));
    }
    return box;
  }

  // ---------- 카드 ----------
  const nameOf = (n) => (n && typeof n === "object" ? (state.uiLang === "ko" ? n.ko : `${n.en || n.ko}${n.ko && n.en ? ` (${n.ko})` : ""}`) : String(n || ""));
  function badge(card) {
    return card.is_sample
      ? el("span", { class: "badge sample", text: `${t("sample")}` })
      : el("span", { class: "badge real", text: `${t("real")} · ${card.source}` });
  }
  function cardEl(card) {
    const d = card.data || {};
    const kind = el("div", { class: "card-kind", text: t("kinds")[card.type] || card.type });
    const badges = el("div", { class: "badges" }, badge(card));
    let title = "", lines = [], actions = [], img = null;
    if (card.type === "festival") {
      title = d.title;
      lines.push(`${d.start} ~ ${d.end}${d.ongoing ? ` · ${t("ongoing")}` : ""}`, `${d.place || ""} · ${d.district || ""}`);
      if (d.free) lines.push(t("free")); else if (d.fee) lines.push(d.fee);
      const link = safeUrl(d.link);
      if (link) actions.push(el("a", { class: "btn", href: link, target: "_blank", rel: "noopener noreferrer", text: t("official") }));
      const src = safeUrl(d.image);
      if (src) { img = el("img", { src, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }); img.addEventListener("error", () => img.remove(), { once: true }); }
    } else if (card.type === "place") {
      title = nameOf(d.name);
      lines.push(`${d.district || ""} · ${t("hours")} ${d.open_hours || "-"}`);
      if (d.flags && (d.flags.is_traditional_market || d.flags.is_local_small_business)) badges.append(el("span", { class: "badge local", text: t("local") }));
      if (Array.isArray(d.tags)) lines.push(d.tags.slice(0, 4).join(" · "));
    } else if (card.type === "transit") {
      title = `${d.from} → ${d.to}`;
      const sum = d.summary || {};
      lines.push(state.uiLang === "ko" ? sum.ko : sum.en || sum.ko, `${t("minutes")(d.total_minutes)} · ₩${Number(d.fare_krw || 0).toLocaleString()}`);
    } else if (card.type === "dsp") {
      title = d.name;
      lines.push(`${d.duration_hours}h · ${t("price")} ₩${Number(d.price_krw || 0).toLocaleString()}`,
        (d.includes || []).map((i) => i.name).join(", "));
      const path = sameOriginPath(d.checkout_url ? `/${String(d.checkout_url).replace(/^\/+/, "")}` : "");
      if (path) {
        const href = `${path}${path.includes("?") ? "&" : "?"}lang=${encodeURIComponent(state.uiLang)}`;
        // 새 탭으로 열어 채팅(메모리에만 있음)이 사라지지 않게 함
        actions.push(el("a", { class: "btn primary", href, target: "_blank", rel: "noopener", "aria-label": `${t("buy")}: ${d.name}`, text: t("buy") }));
      }
    } else if (card.type === "center") {
      title = nameOf(d.name);
      lines.push(`${d.district || ""} · ${t("hours")} ${d.hours || "-"}`,
        (d.languages || []).map((l) => t("langs")[l] || l).join(", "), t("hotline"));
      actions.push(el("a", { class: "btn primary", href: "tel:1330", "aria-label": t("call"), text: t("call") }));
    }
    return el("article", { class: "card" },
      el("div", { class: "card-head" }, el("div", {}, kind, el("h3", { text: title || "" })), badges),
      ...lines.filter(Boolean).map((l, i) => el("p", { class: i === 0 ? "meta-line" : "", text: l })),
      img, actions.length ? el("div", { class: "card-actions" }, ...actions) : null);
  }

  // ---------- 대화 ----------
  const log = $("log");
  function scrollDown() { log.scrollTop = log.scrollHeight; }
  function addUser(text) { log.append(el("div", { class: "msg user", text })); scrollDown(); }
  function addBot(body) {
    if (Array.isArray(body.notices)) for (const n of body.notices) log.append(el("div", { class: "notice", role: "alert", text: n.text }));
    if (body.reply) log.append(el("div", { class: "msg bot" }, renderText(body.reply)));
    if (Array.isArray(body.cards) && body.cards.length) {
      log.append(el("section", { class: "cards", "aria-label": "results" }, ...body.cards.map(cardEl)));
      if (body.ranking_note) log.append(el("p", { class: "ranking-note", text: body.ranking_note }));
    }
    scrollDown();
  }
  function addError(text) { log.append(el("div", { class: "msg bot error", role: "alert", text })); scrollDown(); }

  async function post(payload) {
    const res = await fetch("/api/chat", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Session-Id": state.sessionId },
      body: JSON.stringify(payload),
    });
    let body = {};
    try { body = await res.json(); } catch { /* 본문 없음 */ }
    if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : t("error"));
    return body;
  }

  async function withBusy(fn) {
    if (state.busy) return;
    state.busy = true;
    $("send").disabled = true;
    const typing = el("div", { class: "typing", text: t("typing") });
    log.append(typing); scrollDown();
    try { await fn(); } catch (e) { addError(e instanceof Error && e.message ? e.message.slice(0, 300) : t("error")); }
    finally { typing.remove(); state.busy = false; $("send").disabled = false; $("input").focus(); }
  }

  function send(text) {
    const content = text.trim().slice(0, 1000);
    if (!content) return;
    addUser(content);
    state.messages.push({ role: "user", content });
    withBusy(async () => {
      const body = await post({ messages: state.messages.slice(-20), lang: state.lang === "auto" ? undefined : state.lang });
      if (body.lang && LANGS.includes(body.lang) && state.lang === "auto") { state.uiLang = body.lang; renderChrome(); }
      addBot(body);
      if (body.reply) state.messages.push({ role: "assistant", content: body.reply });
    });
  }

  function handoff() {
    const lastUser = [...state.messages].reverse().find((m) => m.role === "user");
    withBusy(async () => {
      const body = await post({ handoff: true, region: lastUser ? lastUser.content.slice(0, 50) : "", lang: state.lang === "auto" ? state.uiLang : state.lang });
      log.append(el("div", { class: "msg bot", text: t("handoffMsg") }));
      addBot(body);
    });
  }

  function renderChrome() {
    document.documentElement.lang = state.uiLang;
    $("demo-banner").textContent = t("banner");
    $("send").textContent = t("send");
    $("send").setAttribute("aria-label", t("sendLabel"));
    $("input").placeholder = t("placeholder");
    $("handoff").textContent = t("handoff");
    $("handoff").setAttribute("aria-label", t("handoff"));
    $("privacy").textContent = t("privacy");
    $("lang-label").textContent = t("langLabel");
  }

  function init() {
    renderChrome();
    log.append(el("p", { class: "welcome", text: t("welcome") }));
    $("suggestions").setAttribute("aria-label", "Demo scenarios");
    $("suggestions").replaceChildren(...SUGGESTIONS.map((s) => el("button", { type: "button", class: "chip", text: s, onclick: () => send(s) })));
    $("form").addEventListener("submit", (e) => { e.preventDefault(); const v = $("input").value; $("input").value = ""; updateCounter(); send(v); });
    $("input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("form").requestSubmit(); }
    });
    const updateCounter = () => { $("counter").textContent = `${$("input").value.length}/1000`; };
    $("input").addEventListener("input", updateCounter);
    $("handoff").addEventListener("click", handoff);
    $("lang").addEventListener("change", (e) => {
      state.lang = LANGS.includes(e.target.value) ? e.target.value : "auto";
      if (state.lang !== "auto") state.uiLang = state.lang;
      renderChrome();
    });
  }
  init();
})();
