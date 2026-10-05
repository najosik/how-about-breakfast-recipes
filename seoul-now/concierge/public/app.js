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
      koOrig: "국문 원문", hoursAsk: "영업시간은 물어보시면 조회", photo: (n) => `사진: 한국관광공사 (공공누리 제${n}유형)`, estimate: "추정", real: "실데이터", sample: "샘플 데이터", local: "지역 상권", buy: "구매하기 (시연)", official: "공식 페이지", call: "1330 전화",
      error: "연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.", sendLabel: "메시지 보내기", langLabel: "언어 선택",
      walkMin: (m, d) => `도보 약 ${m}분 (${d}m)`, optLine: (m, n) => `약 ${m}분 · 환승 ${n}회`, legWalk: (m) => `도보 ${m}분`, legSubway: (l) => `지하철 ${l}`, legBus: (l) => `${l}번 버스`, stopsN: (n) => `${n}정거장`, est: "시간은 거리 기반 추정치입니다. 실시간 경로는 지도 앱에서 확인하세요.", nTransit: "네이버 지도 (대중교통)", nWalk: "네이버 지도 (도보)", gTransit: "구글 지도 (대중교통)", gWalk: "구글 지도 (도보)", naver: "네이버 지도", kakao: "카카오맵", tipLbl: "팁", fastest: "가장 빠름", subwayOpt: "지하철", busOpt: "버스", kinds: { route: "길 안내", festival: "축제·행사", place: "추천 장소", transit: "교통 안내", dsp: "디스커버 서울 패스", center: "관광정보센터" },
      hours: "운영", price: "가격(샘플)", free: "무료", ongoing: "진행 중", minutes: (m) => `약 ${m}분`, handoffMsg: "가까운 관광정보센터를 안내해 드릴게요. 직원과 직접 상담할 수 있어요.",
      langs: { ko: "한국어", en: "영어", ja: "일본어", zh: "중국어" }, hotline: "관광통역안내 1330: 24시간, 다국어 상담", naver: "네이버 지도에서 길찾기" },
    en: { banner: "Seoul Tourism Organization internal demo · No real payments or bookings", send: "Send", placeholder: "Ask about transport, food, shopping, festivals",
      handoff: "Talk to a person (Tourist Information Center)", privacy: "Please don't enter names, phone numbers or passport numbers. Chats are not saved.",
      welcome: "Hello! I can help with transport, food, shopping and festivals in Seoul — all in one answer.", typing: "Preparing your answer…",
      koOrig: "Original in Korean", hoursAsk: "Ask for opening hours", photo: (n) => `Photo: Korea Tourism Organization (KOGL Type ${n})`, estimate: "Estimate", real: "Real data", sample: "Sample data", local: "Local business", buy: "Buy (demo)", official: "Official page", call: "Call 1330",
      error: "Connection problem. Please try again shortly.", sendLabel: "Send message", langLabel: "Language",
      walkMin: (m, d) => `Walk about ${m} min (${d} m)`, optLine: (m, n) => `About ${m} min · ${n} transfer${n === 1 ? "" : "s"}`, legWalk: (m) => `Walk ${m} min`, legSubway: (l) => (/^\d+호선$/.test(l) ? `Subway Line ${l.replace("호선", "")}` : `Subway ${l}`), legBus: (l) => `Bus ${l}`, stopsN: (n) => `${n} stop${n === 1 ? "" : "s"}`, est: "Times are estimates from distances. Check the map app for live routes.", nTransit: "Naver Map (transit)", nWalk: "Naver Map (walk)", gTransit: "Google Maps (transit)", gWalk: "Google Maps (walk)", naver: "Naver Map", kakao: "KakaoMap", tipLbl: "Tip", fastest: "Fastest", subwayOpt: "Subway", busOpt: "Bus", kinds: { route: "Directions", festival: "Festival / event", place: "Recommended place", transit: "Getting there", dsp: "Discover Seoul Pass", center: "Tourist info center" },
      hours: "Hours", price: "Price (sample)", free: "Free", ongoing: "On now", minutes: (m) => `about ${m} min`, handoffMsg: "Here is the nearest tourist information center, where staff can help you in person.",
      langs: { ko: "Korean", en: "English", ja: "Japanese", zh: "Chinese" }, hotline: "Korea Travel Hotline 1330: 24/7, multilingual", naver: "Directions in Naver Map" },
    ja: { banner: "ソウル観光財団 社内デモ用プロトタイプ・実際の決済や予約は行いません", send: "送信", placeholder: "交通・グルメ・ショッピング・お祭りについて質問",
      handoff: "スタッフにつなぐ（観光案内所）", privacy: "氏名・電話番号・パスポート番号は入力しないでください。会話は保存されません。",
      welcome: "こんにちは！ソウルの交通・グルメ・ショッピング・お祭りをまとめてご案内します。", typing: "回答を準備しています…",
      koOrig: "韓国語原文", hoursAsk: "営業時間はお尋ねください", photo: (n) => `写真：韓国観光公社（公共ヌリ第${n}類型）`, estimate: "推定", real: "実データ", sample: "サンプル", local: "地域の商店", buy: "購入（デモ）", official: "公式ページ", call: "1330に電話",
      error: "接続に問題があります。しばらくしてからお試しください。", sendLabel: "メッセージを送信", langLabel: "言語",
      walkMin: (m, d) => `徒歩 約${m}分（${d}m）`, optLine: (m, n) => `約${m}分・乗り換え${n}回`, legWalk: (m) => `徒歩${m}分`, legSubway: (l) => `地下鉄${l.replace("호선", "号線")}`, legBus: (l) => `バス${l}番`, stopsN: (n) => `${n}駅/停留所`, est: "時間は距離からの推定です。リアルタイムの経路は地図アプリでご確認ください。", nTransit: "NAVER地図（公共交通）", nWalk: "NAVER地図（徒歩）", gTransit: "Googleマップ（公共交通）", gWalk: "Googleマップ（徒歩）", naver: "NAVER地図", kakao: "カカオマップ", tipLbl: "ヒント", fastest: "最速", subwayOpt: "地下鉄", busOpt: "バス", kinds: { route: "ルート案内", festival: "お祭り・イベント", place: "おすすめスポット", transit: "アクセス", dsp: "ディスカバーソウルパス", center: "観光案内所" },
      hours: "営業", price: "価格（サンプル）", free: "無料", ongoing: "開催中", minutes: (m) => `約${m}分`, handoffMsg: "最寄りの観光案内所です。スタッフが直接ご案内します。",
      langs: { ko: "韓国語", en: "英語", ja: "日本語", zh: "中国語" }, hotline: "観光通訳案内1330：24時間・多言語対応", naver: "NAVER地図で経路検索" },
    "zh-CN": { banner: "首尔旅游财团内部演示原型 · 不进行真实支付或预订", send: "发送", placeholder: "询问交通、美食、购物、节庆",
      handoff: "转接人工（旅游咨询中心）", privacy: "请勿输入姓名、电话或护照号码。对话不会被保存。",
      welcome: "您好！我可以一次性为您介绍首尔的交通、美食、购物和节庆。", typing: "正在准备回答…",
      koOrig: "韩文原文", hoursAsk: "营业时间可询问查询", photo: (n) => `图片：韩国观光公社（公共授权第${n}类）`, estimate: "估算", real: "真实数据", sample: "示例数据", local: "本地商家", buy: "购买（演示）", official: "官方页面", call: "拨打1330",
      error: "连接出现问题，请稍后再试。", sendLabel: "发送消息", langLabel: "语言",
      walkMin: (m, d) => `步行约${m}分钟（${d}米）`, optLine: (m, n) => `约${m}分钟 · 换乘${n}次`, legWalk: (m) => `步行${m}分钟`, legSubway: (l) => `地铁${l.replace("호선", "号线")}`, legBus: (l) => `${l}路公交`, stopsN: (n) => `${n}站`, est: "时间为根据距离的估算。实时路线请在地图应用中查看。", nTransit: "Naver地图（公共交通）", nWalk: "Naver地图（步行）", gTransit: "谷歌地图（公共交通）", gWalk: "谷歌地图（步行）", naver: "Naver地图", kakao: "Kakao地图", tipLbl: "提示", fastest: "最快", subwayOpt: "地铁", busOpt: "公交", kinds: { route: "路线指引", festival: "节庆·活动", place: "推荐地点", transit: "交通指南", dsp: "首尔通票", center: "旅游咨询中心" },
      hours: "营业", price: "价格（示例）", free: "免费", ongoing: "进行中", minutes: (m) => `约${m}分钟`, handoffMsg: "为您推荐最近的旅游咨询中心，工作人员可当面为您服务。",
      langs: { ko: "韩语", en: "英语", ja: "日语", zh: "中文" }, hotline: "旅游翻译热线1330：24小时多语种服务", naver: "在 NAVER 地图中查路线" },
    "zh-TW": { banner: "首爾觀光財團內部展示原型 · 不進行實際付款或預訂", send: "傳送", placeholder: "詢問交通、美食、購物、節慶",
      handoff: "轉接真人（觀光諮詢中心）", privacy: "請勿輸入姓名、電話或護照號碼。對話不會被儲存。",
      welcome: "您好！我可以一次為您介紹首爾的交通、美食、購物與節慶。", typing: "正在準備回答…",
      koOrig: "韓文原文", hoursAsk: "營業時間可詢問查詢", photo: (n) => `圖片：韓國觀光公社（公共授權第${n}類）`, estimate: "估算", real: "真實資料", sample: "範例資料", local: "在地商家", buy: "購買（展示）", official: "官方頁面", call: "撥打1330",
      error: "連線發生問題，請稍後再試。", sendLabel: "傳送訊息", langLabel: "語言",
      walkMin: (m, d) => `步行約${m}分鐘（${d}公尺）`, optLine: (m, n) => `約${m}分鐘 · 轉乘${n}次`, legWalk: (m) => `步行${m}分鐘`, legSubway: (l) => `地鐵${l.replace("호선", "號線")}`, legBus: (l) => `${l}路公車`, stopsN: (n) => `${n}站`, est: "時間為依距離的估算。即時路線請在地圖應用程式中查看。", nTransit: "Naver地圖（大眾運輸）", nWalk: "Naver地圖（步行）", gTransit: "Google地圖（大眾運輸）", gWalk: "Google地圖（步行）", naver: "Naver地圖", kakao: "Kakao地圖", tipLbl: "提示", fastest: "最快", subwayOpt: "地鐵", busOpt: "公車", kinds: { route: "路線指引", festival: "節慶·活動", place: "推薦地點", transit: "交通指南", dsp: "首爾通行證", center: "觀光諮詢中心" },
      hours: "營業", price: "價格（範例）", free: "免費", ongoing: "進行中", minutes: (m) => `約${m}分鐘`, handoffMsg: "為您介紹最近的觀光諮詢中心，工作人員可當面為您服務。",
      langs: { ko: "韓語", en: "英語", ja: "日語", zh: "中文" }, hotline: "觀光翻譯熱線1330：24小時多語服務", naver: "在 NAVER 地圖中查路線" },
  };
  // 시연 시나리오(§3) 바로가기
  const SUGGESTIONS = [
    "I'm near Myeongdong tonight. Where can I eat, how do I get to a night market, and any festivals this week?",
    "東京から来ました。ショッピングがしたいです。",
    "3일 동안 궁이랑 전망대 가고 싶어요.",
    "我想和真人说话，我的包丢了。",
  ];

  // 백엔드: Worker 배포에서는 /api/chat, claude.ai 아티팩트에서는 페이지 안 엔진(window.ConciergeBackend)
  const backend = window.ConciergeBackend || null;
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

  // ---------- 네이버 지도: 장소 검색 링크(웹 https, 앱 설치 시 앱으로 열림). 거기서 '길찾기 → 대중교통'.
  // 사용자의 현재 위치는 보내지 않는다(목적지 이름만).
  function naverLink(query) {
    const q = String(query || "").split(/[,(·/]/)[0].replace(/\s+/g, " ").trim().slice(0, 40);
    if (!q) return null;
    return el("a", { class: "btn naver", href: `https://map.naver.com/p/search/${encodeURIComponent(q)}`,
      target: "_blank", rel: "noopener noreferrer", "aria-label": `${t("naver")}: ${q}`, text: t("naver") });
  }

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
  const nameOf = (n) => {
    if (!n || typeof n !== "object") return String(n || "");
    if (state.uiLang !== "ko" && state.uiLang !== "en" && typeof n[state.uiLang] === "string") return n[state.uiLang];
    if (state.uiLang === "ko" && n.ko) return n.ko;
    if (n.en || n.ko) return `${n.en || n.ko}${n.ko && n.en ? ` (${n.ko})` : ""}`;
    return String(Object.values(n).find((v) => typeof v === "string") || "");
  };
  function badge(card) {
    if (card.type === "route") return el("span", { class: "badge sample", text: `${t("estimate")} · ${card.source}` });
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
      actions.push(naverLink(d.place));
      const link = safeUrl(d.link);
      if (link) actions.push(el("a", { class: "btn", href: link, target: "_blank", rel: "noopener noreferrer", text: t("official") }));
      const src = backend && backend.noImages ? "" : safeUrl(d.image);
      if (src) { img = el("img", { src, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }); img.addEventListener("error", () => img.remove(), { once: true }); }
    } else if (card.type === "place") {
      title = nameOf(d.name);
      if (d.detail_id) {
        // 한국관광공사 TourAPI 음식점: 원문 그대로 표시(번역은 답변에서만), 사진은 공공누리 유형 표기
        if (d.needs_translation) badges.append(el("span", { class: "badge sample", text: t("koOrig") }));
        lines.push(d.address || d.district || "", t("hoursAsk"));
        const src = backend && backend.noImages ? "" : safeUrl(d.image);
        const type = { Type1: "1", Type3: "3" }[d.image_license];
        if (src && type) {
          img = el("figure", { class: "photo" + (type === "3" ? " no-modify" : "") },
            el("img", { src, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }), el("figcaption", { text: t("photo")(type) }));
          img.querySelector("img").addEventListener("error", () => img.remove(), { once: true });
        }
      } else lines.push(`${d.district || ""} · ${t("hours")} ${d.open_hours || "-"}`);
      if (d.flags && (d.flags.is_traditional_market || d.flags.is_local_small_business)) badges.append(el("span", { class: "badge local", text: t("local") }));
      if (Array.isArray(d.tags)) lines.push(d.tags.slice(0, 4).join(" · "));
      actions.push(naverLink((d.name && d.name.ko) || nameOf(d.name)));
    } else if (card.type === "route") {
      // 경로 카드: 코드가 도구 결과로 직접 그린다. 시간은 추정치, 실시간 경로는 지도 앱 버튼으로
      const o = d.origin && d.origin.name ? d.origin.name : "";
      title = o ? `${o} → ${d.destination.name}` : d.destination.name;
      if (d.walk) lines.push(t("walkMin")(d.walk.minutes, d.walk.meters));
      const legText = (l) => l.mode === "walk" ? t("legWalk")(l.minutes)
        : `${l.mode === "subway" ? t("legSubway")(String(l.line)) : t("legBus")(String(l.line))} ${l.from} → ${l.to} (${t("stopsN")(l.stops)}, ${l.minutes}′)`;
      for (const op of Array.isArray(d.options) ? d.options.slice(0, 2) : []) {
        const label = { fastest: t("fastest"), subway: t("subwayOpt"), bus: t("busOpt") }[op.label] || "";
        lines.push(`${label ? label + " · " : ""}${t("optLine")(op.total_minutes, op.transfers)}`, (op.legs || []).map(legText).join(" → "));
      }
      for (const tip of Array.isArray(d.tips) ? d.tips.slice(0, 2) : []) lines.push(`${t("tipLbl")}: ${tip.text}`);
      lines.push(t("est"));
      const L = d.links || {};
      const linkBtn = (href, label, cls) => { const u = typeof href === "string" && /^https:\/\//.test(href) ? safeUrl(href) : ""; return u ? el("a", { class: "btn " + (cls || ""), href: u, target: "_blank", rel: "noopener noreferrer", text: label }) : null; };
      actions.push(linkBtn(L.naver_transit || L.naver, t("nTransit"), "naver"), linkBtn(L.naver_walking, t("nWalk"), "naver"), linkBtn(L.google_transit, t("gTransit")), linkBtn(L.google_walking, t("gWalk")), linkBtn(L.kakao, t("kakao")));
    } else if (card.type === "transit") {
      title = `${d.from} → ${d.to}`;
      const sum = d.summary || {};
      lines.push(state.uiLang === "ko" ? sum.ko : sum.en || sum.ko, `${t("minutes")(d.total_minutes)} · ₩${Number(d.fare_krw || 0).toLocaleString()}`);
      actions.push(naverLink(d.to));
    } else if (card.type === "dsp") {
      title = d.name;
      lines.push(`${d.duration_hours}h · ${t("price")} ₩${Number(d.price_krw || 0).toLocaleString()}`,
        (d.includes || []).map((i) => i.name).join(", "));
      const path = sameOriginPath(d.checkout_url ? `/${String(d.checkout_url).replace(/^\/+/, "")}` : "");
      if (path && backend && backend.product) {
        // 아티팩트: 같은 페이지 안의 목업 결제 화면
        actions.push(el("button", { type: "button", class: "btn primary", "aria-label": `${t("buy")}: ${d.name}`, text: t("buy"),
          onclick: () => openCheckout(String(d.id || "")) }));
      } else if (path) {
        const href = `${path}${path.includes("?") ? "&" : "?"}lang=${encodeURIComponent(state.uiLang)}`;
        // 새 탭으로 열어 채팅(메모리에만 있음)이 사라지지 않게 함
        actions.push(el("a", { class: "btn primary", href, target: "_blank", rel: "noopener", "aria-label": `${t("buy")}: ${d.name}`, text: t("buy") }));
      }
    } else if (card.type === "center") {
      title = nameOf(d.name);
      lines.push(`${d.district || ""} · ${t("hours")} ${d.hours || "-"}`,
        (d.languages || []).map((l) => t("langs")[l] || l).join(", "), t("hotline"));
      actions.push(el("a", { class: "btn primary", href: "tel:1330", "aria-label": t("call"), text: t("call") }));
      actions.push(naverLink(d.name && d.name.ko));
    }
    return el("article", { class: "card" },
      el("div", { class: "card-head" }, el("div", {}, kind, el("h3", { text: title || "" })), badges),
      ...lines.filter(Boolean).map((l, i) => el("p", { class: i === 0 ? "meta-line" : "", text: l })),
      img, actions.filter(Boolean).length ? el("div", { class: "card-actions" }, ...actions.filter(Boolean)) : null);
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

  async function post(payload, onProgress) {
    if (backend) return backend.chat(payload, { onProgress });
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
    const typing = el("div", { class: "typing", role: "status", text: t("typing") });
    log.append(typing); scrollDown();
    const progress = (label) => { if (label) typing.textContent = `${t("typing")} ${label}`; };
    try { await fn(progress); } catch (e) { addError(e instanceof Error && e.message ? e.message.slice(0, 300) : t("error")); }
    finally { typing.remove(); state.busy = false; $("send").disabled = false; $("input").focus(); }
  }

  function send(text) {
    const content = text.trim().slice(0, 1000);
    if (!content) return;
    addUser(content);
    state.messages.push({ role: "user", content });
    withBusy(async (progress) => {
      const body = await post({ messages: state.messages.slice(-20), lang: state.lang === "auto" ? undefined : state.lang }, progress);
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

  // ---------- 목업 결제 (아티팩트: 페이지 안 오버레이). 결제 정보 입력란 없음, 아무 요청도 보내지 않음 ----------
  const CO = {
    ko: { stamp: "시연용 – 실제 결제 아님", note: "결제 정보를 입력받지 않으며 실제로 결제·예약되지 않습니다. 실제 서비스에서는 OK-Seoul 등 공식 결제 화면으로 연결됩니다.",
      confirm: "시연 완료 보기 (결제되지 않음)", done: "시연이 완료되었습니다. 실제 결제·예약은 이루어지지 않았습니다.", code: "시연 번호(효력 없음)", close: "닫기", price: "가격(샘플)" },
    en: { stamp: "DEMO – NOT A REAL PAYMENT", note: "No payment details are collected and nothing is charged or booked. A real service would hand off to an official checkout such as OK-Seoul.",
      confirm: "Show demo completion (no charge)", done: "Demo complete. No payment or booking was made.", code: "Demo reference (not valid)", close: "Close", price: "Price (sample)" },
    ja: { stamp: "デモ用 – 実際の決済ではありません", note: "決済情報は入力せず、実際の決済・予約は行われません。実サービスではOK-Seoulなど公式の決済画面へ移動します。",
      confirm: "デモ完了を表示（決済されません）", done: "デモが完了しました。実際の決済・予約は行われていません。", code: "デモ番号（無効）", close: "閉じる", price: "価格（サンプル）" },
    "zh-CN": { stamp: "演示用 – 非真实支付", note: "不收集支付信息，也不会产生真实扣款或预订。正式服务将跳转至 OK-Seoul 等官方支付页面。",
      confirm: "查看演示完成（不扣款）", done: "演示完成。未进行任何真实支付或预订。", code: "演示编号（无效）", close: "关闭", price: "价格（示例）" },
    "zh-TW": { stamp: "展示用 – 非實際付款", note: "不收集付款資訊，也不會產生實際扣款或預訂。正式服務將連結至 OK-Seoul 等官方付款頁面。",
      confirm: "查看展示完成（不扣款）", done: "展示完成。未進行任何實際付款或預訂。", code: "展示編號（無效）", close: "關閉", price: "價格（範例）" },
  };
  function openCheckout(id) {
    const c = CO[state.uiLang] || CO.en;
    const p = backend.product(id);
    if (!p) return;
    const result = el("div", { class: "co-result", role: "status", hidden: "" });
    const confirm = el("button", { type: "button", class: "send co-confirm", text: c.confirm });
    const close = el("button", { type: "button", class: "btn", text: c.close });
    const panel = el("div", { class: "co-panel", role: "dialog", "aria-modal": "true", "aria-label": c.stamp },
      el("p", { class: "demo-stamp", role: "alert" }, el("strong", { text: c.stamp }), el("span", { text: "DEMO ONLY · NOT A REAL PAYMENT" })),
      el("div", { class: "co-body" },
        el("article", { class: "card" }, el("div", { class: "card-kind", text: "Discover Seoul Pass" }), el("h3", { text: p.name }),
          el("div", { class: "badges" }, el("span", { class: "badge sample", text: t("sample") })),
          el("p", { class: "meta-line", text: `${c.price} ₩${Number(p.price_krw || 0).toLocaleString()} · ${p.duration_hours}h` }),
          el("p", { text: (p.includes || []).map((i) => i.name).join(", ") })),
        el("p", { class: "co-note", text: c.note }), confirm, result, close));
    const overlay = el("div", { class: "co-overlay" }, panel);
    const onKey = (e) => { if (e.key === "Escape") shut(); };
    const shut = () => { document.removeEventListener("keydown", onKey); overlay.remove(); $("input").focus(); };
    close.addEventListener("click", shut);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) shut(); });   // 바깥(어두운 영역) 누르면 닫힘
    document.addEventListener("keydown", onKey);
    confirm.addEventListener("click", () => {
      const a = new Uint8Array(3); crypto.getRandomValues(a);
      result.replaceChildren(el("p", { text: c.done }), el("p", { text: `${c.code}: DEMO-${[...a].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}` }));
      result.hidden = false; confirm.disabled = true; close.focus();
    });
    document.body.append(overlay);
    confirm.focus();
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
    if (backend && backend.dataNote) log.append(el("p", { class: "welcome", text: backend.dataNote(state.uiLang) }));
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
