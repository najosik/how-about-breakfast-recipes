// 서울 AI 컨시어지 채팅 UI (내부 시연용).
// 보안: LLM 출력은 신뢰하지 않는 입력(A03). innerHTML을 쓰지 않고 textContent + 허용된 마크다운(**굵게**, - 목록)만 DOM으로 만든다.
// 개인정보: 대화는 이 페이지의 메모리에만 있고 저장하지 않는다(새로고침하면 사라짐).
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const LANGS = ["ko", "en", "ja", "zh-CN", "zh-TW"];
  const T = {
    ko: { banner: "서울관광재단 내부 시연용 프로토타입 · 실제 결제·예약 없음", send: "보내기", placeholder: "서울 여행, 무엇이든 물어보세요",
      handoff: "상담원 연결 (관광정보센터)", privacy: "이름·연락처·여권번호는 입력하지 마세요. 대화는 저장되지 않습니다.",
      welcome: "안녕하세요! 서울 여행의 교통·음식·쇼핑·축제를 한 번에 안내해 드려요.", typing: "답변을 준비하고 있어요…",
      koOrig: "국문 원문", hoursAsk: "영업시간은 물어보시면 조회", photo: (n) => `사진: 한국관광공사 (공공누리 제${n}유형)`, estimate: "추정", real: "실데이터", sample: "샘플 데이터", local: "지역 상권", buy: "구매하기 (시연)", official: "공식 페이지", call: "1330 전화",
      error: "연결에 문제가 있어요. 잠시 후 다시 시도해 주세요.", sendLabel: "메시지 보내기", langLabel: "언어 선택",
      walkMin: (m, d) => `도보 약 ${m}분 (${d}m)`, optLine: (m, n) => `약 ${m}분 · 환승 ${n}회`, legWalk: (m) => `도보 ${m}분`, legSubway: (l) => `지하철 ${l}`, legBus: (l) => `${l}번 버스`, stopsN: (n) => `${n}정거장`, est: "시간은 거리 기반 추정치입니다. 실시간 경로는 지도 앱에서 확인하세요.", nTransit: "네이버 지도로 길찾기", nWalk: "네이버 · 도보", gTransit: "구글 · 대중교통", gWalk: "구글 · 도보", naver: "네이버 지도", kakao: "카카오맵", tipLbl: "팁", fastest: "가장 빠름", subwayOpt: "지하철", busOpt: "버스", kinds: { route: "길 안내", festival: "축제·행사", place: "추천 장소", transit: "교통 안내", dsp: "디스커버 서울 패스", center: "관광정보센터" },
      hours: "운영", price: "가격(샘플)", free: "무료", ongoing: "진행 중", minutes: (m) => `약 ${m}분`, handoffMsg: "가까운 관광정보센터를 안내해 드릴게요. 직원과 직접 상담할 수 있어요.",
      langs: { ko: "한국어", en: "영어", ja: "일본어", zh: "중국어" }, hotline: "관광통역안내 1330: 24시간, 다국어 상담", naver: "네이버 지도에서 길찾기" },
    en: { banner: "Seoul Tourism Organization internal demo · No real payments or bookings", send: "Send", placeholder: "Ask me anything about Seoul",
      handoff: "Talk to a person (Tourist Information Center)", privacy: "Please don't enter names, phone numbers or passport numbers. Chats are not saved.",
      welcome: "Hello! I can help with transport, food, shopping and festivals in Seoul — all in one answer.", typing: "Preparing your answer…",
      koOrig: "Original in Korean", hoursAsk: "Ask for opening hours", photo: (n) => `Photo: Korea Tourism Organization (KOGL Type ${n})`, estimate: "Estimate", real: "Real data", sample: "Sample data", local: "Local business", buy: "Buy (demo)", official: "Official page", call: "Call 1330",
      error: "Connection problem. Please try again shortly.", sendLabel: "Send message", langLabel: "Language",
      walkMin: (m, d) => `Walk about ${m} min (${d} m)`, optLine: (m, n) => `About ${m} min · ${n} transfer${n === 1 ? "" : "s"}`, legWalk: (m) => `Walk ${m} min`, legSubway: (l) => (/^\d+호선$/.test(l) ? `Subway Line ${l.replace("호선", "")}` : `Subway ${l}`), legBus: (l) => `Bus ${l}`, stopsN: (n) => `${n} stop${n === 1 ? "" : "s"}`, est: "Times are estimates from distances. Check the map app for live routes.", nTransit: "Open route in Naver Map", nWalk: "Naver · walk", gTransit: "Google · transit", gWalk: "Google · walk", naver: "Naver Map", kakao: "KakaoMap", tipLbl: "Tip", fastest: "Fastest", subwayOpt: "Subway", busOpt: "Bus", kinds: { route: "Directions", festival: "Festival / event", place: "Recommended place", transit: "Getting there", dsp: "Discover Seoul Pass", center: "Tourist info center" },
      hours: "Hours", price: "Price (sample)", free: "Free", ongoing: "On now", minutes: (m) => `about ${m} min`, handoffMsg: "Here is the nearest tourist information center, where staff can help you in person.",
      langs: { ko: "Korean", en: "English", ja: "Japanese", zh: "Chinese" }, hotline: "Korea Travel Hotline 1330: 24/7, multilingual", naver: "Directions in Naver Map" },
    ja: { banner: "ソウル観光財団 社内デモ用プロトタイプ・実際の決済や予約は行いません", send: "送信", placeholder: "ソウル旅行について何でもどうぞ",
      handoff: "スタッフにつなぐ（観光案内所）", privacy: "氏名・電話番号・パスポート番号は入力しないでください。会話は保存されません。",
      welcome: "こんにちは！ソウルの交通・グルメ・ショッピング・お祭りをまとめてご案内します。", typing: "回答を準備しています…",
      koOrig: "韓国語原文", hoursAsk: "営業時間はお尋ねください", photo: (n) => `写真：韓国観光公社（公共ヌリ第${n}類型）`, estimate: "推定", real: "実データ", sample: "サンプル", local: "地域の商店", buy: "購入（デモ）", official: "公式ページ", call: "1330に電話",
      error: "接続に問題があります。しばらくしてからお試しください。", sendLabel: "メッセージを送信", langLabel: "言語",
      walkMin: (m, d) => `徒歩 約${m}分（${d}m）`, optLine: (m, n) => `約${m}分・乗り換え${n}回`, legWalk: (m) => `徒歩${m}分`, legSubway: (l) => `地下鉄${l.replace("호선", "号線")}`, legBus: (l) => `バス${l}番`, stopsN: (n) => `${n}駅/停留所`, est: "時間は距離からの推定です。リアルタイムの経路は地図アプリでご確認ください。", nTransit: "NAVER地図でルートを開く", nWalk: "NAVER・徒歩", gTransit: "Google・公共交通", gWalk: "Google・徒歩", naver: "NAVER地図", kakao: "カカオマップ", tipLbl: "ヒント", fastest: "最速", subwayOpt: "地下鉄", busOpt: "バス", kinds: { route: "ルート案内", festival: "お祭り・イベント", place: "おすすめスポット", transit: "アクセス", dsp: "ディスカバーソウルパス", center: "観光案内所" },
      hours: "営業", price: "価格（サンプル）", free: "無料", ongoing: "開催中", minutes: (m) => `約${m}分`, handoffMsg: "最寄りの観光案内所です。スタッフが直接ご案内します。",
      langs: { ko: "韓国語", en: "英語", ja: "日本語", zh: "中国語" }, hotline: "観光通訳案内1330：24時間・多言語対応", naver: "NAVER地図で経路検索" },
    "zh-CN": { banner: "首尔旅游财团内部演示原型 · 不进行真实支付或预订", send: "发送", placeholder: "关于首尔旅行，尽管问",
      handoff: "转接人工（旅游咨询中心）", privacy: "请勿输入姓名、电话或护照号码。对话不会被保存。",
      welcome: "您好！我可以一次性为您介绍首尔的交通、美食、购物和节庆。", typing: "正在准备回答…",
      koOrig: "韩文原文", hoursAsk: "营业时间可询问查询", photo: (n) => `图片：韩国观光公社（公共授权第${n}类）`, estimate: "估算", real: "真实数据", sample: "示例数据", local: "本地商家", buy: "购买（演示）", official: "官方页面", call: "拨打1330",
      error: "连接出现问题，请稍后再试。", sendLabel: "发送消息", langLabel: "语言",
      walkMin: (m, d) => `步行约${m}分钟（${d}米）`, optLine: (m, n) => `约${m}分钟 · 换乘${n}次`, legWalk: (m) => `步行${m}分钟`, legSubway: (l) => `地铁${l.replace("호선", "号线")}`, legBus: (l) => `${l}路公交`, stopsN: (n) => `${n}站`, est: "时间为根据距离的估算。实时路线请在地图应用中查看。", nTransit: "在 Naver 地图中查看路线", nWalk: "Naver · 步行", gTransit: "谷歌 · 公共交通", gWalk: "谷歌 · 步行", naver: "Naver地图", kakao: "Kakao地图", tipLbl: "提示", fastest: "最快", subwayOpt: "地铁", busOpt: "公交", kinds: { route: "路线指引", festival: "节庆·活动", place: "推荐地点", transit: "交通指南", dsp: "首尔通票", center: "旅游咨询中心" },
      hours: "营业", price: "价格（示例）", free: "免费", ongoing: "进行中", minutes: (m) => `约${m}分钟`, handoffMsg: "为您推荐最近的旅游咨询中心，工作人员可当面为您服务。",
      langs: { ko: "韩语", en: "英语", ja: "日语", zh: "中文" }, hotline: "旅游翻译热线1330：24小时多语种服务", naver: "在 NAVER 地图中查路线" },
    "zh-TW": { banner: "首爾觀光財團內部展示原型 · 不進行實際付款或預訂", send: "傳送", placeholder: "關於首爾旅行，儘管問",
      handoff: "轉接真人（觀光諮詢中心）", privacy: "請勿輸入姓名、電話或護照號碼。對話不會被儲存。",
      welcome: "您好！我可以一次為您介紹首爾的交通、美食、購物與節慶。", typing: "正在準備回答…",
      koOrig: "韓文原文", hoursAsk: "營業時間可詢問查詢", photo: (n) => `圖片：韓國觀光公社（公共授權第${n}類）`, estimate: "估算", real: "真實資料", sample: "範例資料", local: "在地商家", buy: "購買（展示）", official: "官方頁面", call: "撥打1330",
      error: "連線發生問題，請稍後再試。", sendLabel: "傳送訊息", langLabel: "語言",
      walkMin: (m, d) => `步行約${m}分鐘（${d}公尺）`, optLine: (m, n) => `約${m}分鐘 · 轉乘${n}次`, legWalk: (m) => `步行${m}分鐘`, legSubway: (l) => `地鐵${l.replace("호선", "號線")}`, legBus: (l) => `${l}路公車`, stopsN: (n) => `${n}站`, est: "時間為依距離的估算。即時路線請在地圖應用程式中查看。", nTransit: "在 Naver 地圖中查看路線", nWalk: "Naver · 步行", gTransit: "Google · 大眾運輸", gWalk: "Google · 步行", naver: "Naver地圖", kakao: "Kakao地圖", tipLbl: "提示", fastest: "最快", subwayOpt: "地鐵", busOpt: "公車", kinds: { route: "路線指引", festival: "節慶·活動", place: "推薦地點", transit: "交通指南", dsp: "首爾通行證", center: "觀光諮詢中心" },
      hours: "營業", price: "價格（範例）", free: "免費", ongoing: "進行中", minutes: (m) => `約${m}分鐘`, handoffMsg: "為您介紹最近的觀光諮詢中心，工作人員可當面為您服務。",
      langs: { ko: "韓語", en: "英語", ja: "日語", zh: "中文" }, hotline: "觀光翻譯熱線1330：24小時多語服務", naver: "在 NAVER 地圖中查路線" },
  };
  // 시연 시나리오(§3) 바로가기: 칩에는 짧은 이름, 누르면 원문 질문을 보낸다
  const SUGGESTIONS = [
    ["Myeongdong tonight", "I'm near Myeongdong tonight. Where can I eat, how do I get to a night market, and any festivals this week?"],
    ["東京から・ショッピング", "東京から来ました。ショッピングがしたいです。"],
    ["3일 궁·전망대", "3일 동안 궁이랑 전망대 가고 싶어요."],
    ["真人客服·丢包", "我想和真人说话，我的包丢了。"],
  ];
  // 첫 화면·머리띠 문구. 사람 흉내 없이 AI 안내임을 밝힌다.
  const UI = {
    ko: { greet: "서울 여행, 무엇을 도와드릴까요?", sub: "길 찾기부터 맛집·축제·패스까지, 지금 계신 곳에 맞춰 안내해 드려요.", ai: "AI 안내", staff: "상담원",
      disclaimer: "AI가 생성한 안내로 실제와 다를 수 있습니다. 중요한 정보는 현장에서 확인하세요.", dataLbl: "데이터 안내", scen: "시연",
      quick: [["route", "길 찾기", "명동에서 경복궁 어떻게 가요?"], ["food", "근처 맛집", "명동 근처 맛집 추천해 주세요."], ["fest", "이번 주 축제", "이번 주에 외국인이 즐기기 좋은 축제 있어요?"], ["pass", "패스 추천", "2일 동안 쓸 디스커버 서울 패스 추천해 주세요."]] },
    en: { greet: "How can I help with your Seoul trip?", sub: "Directions, food, festivals and passes, tailored to where you are.", ai: "AI guide", staff: "Staff",
      disclaimer: "AI-generated guidance may differ from reality. Please confirm important details on site.", dataLbl: "About the data", scen: "Demo",
      quick: [["route", "Get directions", "How do I get from Myeongdong to Gyeongbokgung?"], ["food", "Food nearby", "Any good places to eat near Myeongdong?"], ["fest", "Festivals this week", "Any festivals this week that are good for visitors?"], ["pass", "Pick a pass", "Which Discover Seoul Pass suits a 2-day trip?"]] },
    ja: { greet: "ソウル旅行、何をお手伝いしましょうか？", sub: "道案内からグルメ・お祭り・パスまで、今いる場所に合わせてご案内します。", ai: "AI案内", staff: "スタッフ",
      disclaimer: "AIによる案内のため、実際と異なる場合があります。重要な情報は現地でご確認ください。", dataLbl: "データについて", scen: "デモ",
      quick: [["route", "道案内", "明洞から景福宮への行き方を教えて"], ["food", "近くのグルメ", "明洞の近くでおすすめのお店は？"], ["fest", "今週のお祭り", "今週、外国人も楽しめるお祭りはありますか？"], ["pass", "パス選び", "2日間ならどのディスカバーソウルパスがいい？"]] },
    "zh-CN": { greet: "首尔旅行，需要什么帮助？", sub: "从路线到美食、节庆、通票，按您所在的位置为您推荐。", ai: "AI 导览", staff: "人工",
      disclaimer: "以上为 AI 生成的指引，可能与实际不同。重要信息请在现场确认。", dataLbl: "关于数据", scen: "演示",
      quick: [["route", "路线", "从明洞怎么去景福宫？"], ["food", "附近美食", "明洞附近有什么好吃的？"], ["fest", "本周节庆", "这周有适合外国游客的节庆吗？"], ["pass", "通票推荐", "玩2天适合哪种首尔通票？"]] },
    "zh-TW": { greet: "首爾旅行，需要什麼協助？", sub: "從路線到美食、節慶、通行證，依您所在位置為您推薦。", ai: "AI 導覽", staff: "真人",
      disclaimer: "以上為 AI 生成的指引，可能與實際不同。重要資訊請於現場確認。", dataLbl: "關於資料", scen: "展示",
      quick: [["route", "路線", "從明洞怎麼去景福宮？"], ["food", "附近美食", "明洞附近有什麼好吃的？"], ["fest", "本週節慶", "這週有適合外國遊客的節慶嗎？"], ["pass", "通行證推薦", "玩2天適合哪種首爾通行證？"]] },
  };
  const u = (k) => (UI[state.uiLang] || UI.en)[k];
  const ICONS = {
    route: "M5 19c4 0 3-6 7-6s3 6 7 6M5 19a2 2 0 1 0 0-.1M19 5a2 2 0 1 0 0 .1M19 7v4",
    food: "M7 3v8a2 2 0 0 0 4 0V3M9 11v10M16 3c-2 1-2 5-2 7h4V3zM18 10v11",
    fest: "M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z",
    pass: "M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4zM12 7v12",
    walk: "M13 5.5a1.5 1.5 0 1 0 0-.1M10 21l2-6 3 3v3M8 12l4-3 3 3 2 1M12 9l-2 5",
  };
  const icon = (k) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", ICONS[k] || ""); svg.append(path);
    return svg;
  };
  // 서울 지하철 노선 공식 색(대표값), 버스는 번호 체계로 간선·지선·광역·순환 색
  const LINE_COLOR = { "1호선": "#0052A4", "2호선": "#00A84D", "3호선": "#EF7C1C", "4호선": "#00A5DE", "5호선": "#996CAC", "6호선": "#CD7C2F",
    "7호선": "#747F00", "8호선": "#E6186C", "9호선": "#BDB092", "경의선": "#77C4A3", "공항철도": "#0090D2", "수인분당선": "#F5A200",
    "신분당선": "#D4003B", "경춘선": "#0C8E72", "우이신설경전철": "#B0CE18", "신림선": "#6789CA", "서해선": "#8FC31F", "GTX-A": "#9A6292", "김포도시철도": "#A17800" };
  const busColor = (no) => /^N/.test(no) ? "#3c3c3c" : /^(M|9\d{3}$)/.test(no) ? "#E60012" : /^\d{4}$/.test(no) ? "#53B332" : /^\d{2}$/.test(no) ? "#F2B70A" : "#0068B7";
  const lineShort = (l) => (/^(\d)호선$/.test(l) ? l.replace("호선", "") : ({ "경의선": "경의", "공항철도": "공항", "수인분당선": "수인", "신분당선": "신분당", "우이신설경전철": "우이", "김포도시철도": "김포" }[l] || l.slice(0, 3)));

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
    } else if (card.type === "route-legacy") {
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

  // 길 안내 카드: 도구 결과로 코드가 그린다(시간은 추정). 노선 색 띠 + 단계별 타임라인 + 지도 앱 버튼
  function routeEl(card) {
    const d = card.data || {};
    const o = d.origin && d.origin.name ? d.origin.name : "";
    const head = el("div", { class: "route-head" },
      el("div", { class: "card-kind", text: t("kinds").route }),
      el("h3", { class: "from-to" }, o ? el("span", { text: o }) : null, o ? el("span", { class: "arrow", text: "→" }) : null, el("span", { text: d.destination.name })),
      el("div", { class: "badges" }, badge(card)));
    const body = el("div", { class: "route-body" });
    if (d.walk) body.append(el("span", { class: "walk-chip", text: t("walkMin")(d.walk.minutes, d.walk.meters) }));
    (Array.isArray(d.options) ? d.options.slice(0, 2) : []).forEach((op, i) => {
      const label = { fastest: t("fastest"), subway: t("subwayOpt"), bus: t("busOpt") }[op.label] || "";
      const legs = el("ol", { class: "legs" }, ...(op.legs || []).map((l) => {
        if (l.mode === "walk") return el("li", { class: "leg walk" }, el("span", { class: "chipline walk", "aria-hidden": "true" }, icon("walk")), el("div", { class: "leg-text", text: t("legWalk")(l.minutes) }));
        const line = String(l.line || "");
        const chip = el("span", { class: "chipline", text: l.mode === "subway" ? lineShort(line) : line });
        chip.style.background = l.mode === "subway" ? (LINE_COLOR[line] || "#5b6578") : busColor(line);
        const what = l.mode === "subway" ? t("legSubway")(line) : t("legBus")(line);
        return el("li", { class: "leg" }, chip, el("div", { class: "leg-text" },
          el("b", { text: what }), document.createTextNode(` · ${l.from} → ${l.to} `), el("small", { text: `${t("stopsN")(l.stops)} · ${l.minutes}′` })));
      }));
      body.append(el("div", { class: "option" },
        el("div", { class: "option-head" }, label ? el("span", { class: "tag" + (i ? " alt" : ""), text: label }) : null,
          el("span", { class: "mins", text: t("optLine")(op.total_minutes, op.transfers).split("·")[0].trim() }),
          el("span", { class: "xfer", text: (t("optLine")(op.total_minutes, op.transfers).split("·")[1] || "").trim() })),
        legs));
    });
    const tips = Array.isArray(d.tips) ? d.tips.slice(0, 2) : [];
    if (tips.length) body.append(el("div", { class: "tips" }, ...tips.map((tip) => el("p", {}, el("b", { text: `${t("tipLbl")} ` }), tip.text))));
    const L = d.links || {};
    const linkBtn = (href, label, cls) => { const x = typeof href === "string" && /^https:\/\//.test(href) ? safeUrl(href) : ""; return x ? el("a", { class: "btn " + (cls || ""), href: x, target: "_blank", rel: "noopener noreferrer", text: label }) : null; };
    const btns = [linkBtn(L.naver_transit || L.naver, t("nTransit"), "primary wide"), linkBtn(L.naver_walking, t("nWalk"), "naver"),
      linkBtn(L.google_transit, t("gTransit")), linkBtn(L.google_walking, t("gWalk")), linkBtn(L.kakao, t("kakao"))].filter(Boolean);
    body.append(el("div", { class: "route-foot" }, el("p", { class: "est", text: t("est") }), el("div", { class: "map-btns" }, ...btns)));
    return el("article", { class: "route" }, head, body);
  }

  // ---------- 대화 ----------
  const log = $("log");
  function scrollDown() { log.scrollTop = log.scrollHeight; }
  const avatar = () => el("span", { class: "avatar", "aria-hidden": "true", text: "AI" });
  function addUser(text) { log.append(el("div", { class: "row user" }, el("div", { class: "msg user", text }))); scrollDown(); }
  function addBotText(node) { log.append(el("div", { class: "row" }, avatar(), node)); }
  function addBot(body) {
    if (Array.isArray(body.notices)) for (const n of body.notices) log.append(el("div", { class: "notice", role: "alert", text: n.text }));
    if (body.reply) addBotText(el("div", { class: "msg bot" }, renderText(body.reply)));
    const cards = Array.isArray(body.cards) ? body.cards : [];
    if (cards.length) {
      const routes = cards.filter((c) => c.type === "route"), rest = cards.filter((c) => c.type !== "route");
      const box = el("section", { class: "results", "aria-label": "results" }, ...routes.map(routeEl));
      if (rest.length) box.append(el("div", { class: "carousel" }, ...rest.map(cardEl)));
      if (body.ranking_note && rest.length) box.append(el("p", { class: "ranking-note", text: body.ranking_note }));
      log.append(box);
    }
    scrollDown();
  }
  function addError(text) { addBotText(el("div", { class: "msg bot error", role: "alert", text })); scrollDown(); }

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
    const label = el("span", { text: t("typing") });
    const typing = el("div", { class: "row" }, avatar(), el("div", { class: "typing", role: "status" }, el("span", { class: "dots" }, el("i"), el("i"), el("i")), label));
    log.append(typing); scrollDown();
    const progress = (x) => { if (x) label.textContent = x; };
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
      addBotText(el("div", { class: "msg bot", text: t("handoffMsg") }));
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
    $("send").setAttribute("aria-label", t("sendLabel") || t("send"));
    $("ai-pill").textContent = u("ai");
    $("disclaimer").textContent = u("disclaimer");
    $("input").placeholder = t("placeholder");
    $("handoff").textContent = u("staff");
    $("handoff").setAttribute("aria-label", t("handoff"));
    renderHero();
    $("privacy").textContent = t("privacy");
    $("lang-label").textContent = t("langLabel");
  }

  // 첫 화면: 인사 + 바로가기 4개(누르면 해당 언어 예시 질문을 보냄). 대화가 시작되면 그대로 위에 남는다.
  const hero = el("section", { class: "hero", "aria-label": "start" });
  function renderHero() {
    const quick = el("div", { class: "quick" }, ...u("quick").map(([k, label, q]) =>
      el("button", { type: "button", onclick: () => send(q) }, el("span", { class: "ico" }, icon(k)), el("span", { text: label }))));
    const kids = [el("h2", { text: u("greet") }), el("p", { text: u("sub") }), quick];
    if (backend && backend.dataNote) kids.push(el("details", { class: "data-note" }, el("summary", { text: u("dataLbl") }), el("p", { text: backend.dataNote(state.uiLang) })));
    hero.replaceChildren(...kids);
  }

  function init() {
    log.append(hero);
    renderChrome();
    $("suggestions").setAttribute("aria-label", "Demo scenarios");
    $("suggestions").replaceChildren(...SUGGESTIONS.map(([label, q]) => el("button", { type: "button", class: "chip", title: q, onclick: () => send(q) }, `${u("scen")} · ${label}`)));
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
