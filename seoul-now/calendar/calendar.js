// 서울 축제 예상 캘린더 — data/calendar_<연도>.json 표시
// 보안: 외부 데이터는 textContent로만 출력(innerHTML 미사용), 링크는 http/https만 허용.
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const CONFS = ["confirmed", "high", "medium", "low"];
  const PARTS = ["early", "mid", "late"];
  const T = {
    en: {
      title: (y) => `${y} Seoul Promotion & Marketing Calendar`,
      sub: "Next year's major Seoul events, forecast from when they were held before",
      back: "← Seoul Now",
      aboutTitle: "How this forecast works",
      about: (n) => `We grouped ${n.toLocaleString("en")} festivals from the last five years by name and looked at when each one was held. Only festivals held in at least two different years, including at least once in the last two years, are shown. Dates are estimates — always check the official page before you go.`,
      conf: { confirmed: "Confirmed", high: "Likely", medium: "Probable", low: "Uncertain" },
      confHow: {
        confirmed: "Next year's dates are already published",
        high: "Held 3+ years, start dates within 21 days",
        medium: "Held 2+ years, within 35 days",
        low: "Timing varies",
      },
      all: "All", likely: "Confirmed + likely",
      months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      monthLong: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
      count: (n) => `${n} festival${n === 1 ? "" : "s"}`,
      part: { early: "Early", mid: "Mid", late: "Late" },
      expected: (p, m) => `Expected: ${p} ${m}`,
      days: (d) => (d > 1 ? ` · about ${d} days` : " · 1 day"),
      past: "Past",
      lunar: "Lunar-calendar holiday event: dates shift every year",
      official: "Official page",
      none: "No festivals match this filter.",
      updated: (d) => `Forecast built ${d}`,
      source: "Source: Seoul Open Data Plaza (Seoul culture events). Festival names are published in Korean only.",
      loadError: "Couldn't load the calendar. Please try again later.",
      langToggle: "한국어",
      funnel: "How the forecast is built",
      funnelSteps: { records: "Festival records", series: "Grouped as the same festival", recurring: "Recurring festivals only", predicted: "Forecast for the year" },
      bars: "Festivals by month", barsNote: (n) => `April–May: ${n} festivals`, barsTable: "Show as table",
      views: { guide: "Guide view", biz: "Business view" },
      guideDates: (a, b) => `Collect info by ${a} (D-60) · Publish by ${b} (D-30)`,
      bizDate: (a, late) => `Start preparing ${a} (D-180)${late ? " · Behind schedule" : ""}`,
      basisBtn: "Why this date?", basisStarts: "Recent start dates", basisMedian: (m) => `Median ${m}`, basisLatest: (m) => `Latest ${m}`,
      basisPart: (p, m) => `→ ${p} ${m}`, basisLive: (d) => `Forecast built ${d} (updated weekly)`, basisSnap: (d, l) => `Fixed snapshot: ${d} · ${l}`,
    },
    ko: {
      title: (y) => `${y} 서울 홍보마케팅 캘린더`,
      sub: "지난 개최 시기로 예측한 내년 서울 주요 행사 일정",
      back: "← Seoul Now",
      aboutTitle: "예측 방법",
      about: (n) => `최근 5년간의 축제 ${n.toLocaleString("ko")}건을 이름으로 묶어 해마다 언제 열렸는지 살폈습니다. 2개 연도 이상 열렸고 최근 2년 안에 한 번 이상 열린 축제만 보여 줍니다. 날짜는 추정이므로 방문 전 반드시 공식 페이지를 확인하세요.`,
      conf: { confirmed: "확정", high: "예상 높음", medium: "예상 보통", low: "예상 낮음" },
      confHow: {
        confirmed: "내년 일정이 이미 공개됨",
        high: "3년 이상 개최, 시작일 차이 21일 이내",
        medium: "2년 이상 개최, 35일 이내",
        low: "시기가 들쭉날쭉",
      },
      all: "전체", likely: "확정 + 예상 높음",
      months: ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"],
      monthLong: ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"],
      count: (n) => `${n}건`,
      part: { early: "초", mid: "중순", late: "하순" },
      expected: (p, m) => `예상: ${m} ${p}`,
      days: (d) => (d > 1 ? ` · 약 ${d}일간` : " · 하루"),
      past: "지난 개최",
      lunar: "음력 명절 행사라 해마다 날짜가 크게 바뀝니다",
      official: "공식 페이지",
      none: "조건에 맞는 축제가 없습니다.",
      updated: (d) => `예측 생성 ${d}`,
      source: "출처: 서울 열린데이터광장 (서울시 문화행사 정보)",
      loadError: "캘린더를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      langToggle: "English",
      funnel: "예측 흐름",
      funnelSteps: { records: "축제 기록", series: "같은 축제끼리 묶기", recurring: "반복 축제만 남기기", predicted: "예측" },
      bars: "월별 축제 분포", barsNote: (n) => `4~5월 ${n}건`, barsTable: "표로 보기",
      views: { guide: "안내 보기", biz: "사업화 보기" },
      guideDates: (a, b) => `취합 ${a} (D-60) · 배포 ${b} (D-30)`,
      bizDate: (a, late) => `착수 ${a} (D-180)${late ? " · 착수 지연" : ""}`,
      basisBtn: "예측 근거", basisStarts: "최근 시작일", basisMedian: (m) => `중앙값 ${m}`, basisLatest: (m) => `최근 개최 ${m}`,
      basisPart: (p, m) => `→ ${m} ${p}`, basisLive: (d) => `예측 생성 ${d} (매주 갱신)`, basisSnap: (d, l) => `기준 일시 ${d} 고정 · ${l}`,
    },
  };
  const state = { lang: "en", filter: "all", view: "guide", snapshot: "" };
  let data = null;
  let snap = null;   // ?snapshot=날짜 → data/snapshots/날짜/ 의 예측을 고정해 보여 줌
  const t = () => T[state.lang];

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c) node.append(c);
    return node;
  }
  function safeUrl(u) {
    try {
      const url = new URL(String(u || ""));
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch { return ""; }
  }
  const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

  function kstYear() {
    return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
  }
  function readUrl() {
    const p = new URLSearchParams(location.search);
    const lang = p.get("lang");
    state.lang = lang === "ko" || lang === "en" ? lang
      : "ko";   // 기본 한국어. 다른 언어는 상단 번역 버튼(구글 번역)으로
    if (p.get("show") === "likely") state.filter = "likely";
    if (p.get("view") === "biz") state.view = "biz";
    const sp = p.get("snapshot");
    state.snapshot = sp && /^\d{4}-\d{2}-\d{2}$/.test(sp) ? sp : "";
  }
  function writeUrl() {
    const p = new URLSearchParams({ lang: state.lang });
    if (state.filter !== "all") p.set("show", state.filter);
    if (state.view !== "guide") p.set("view", state.view);
    if (snap) p.set("snapshot", snap.date);
    history.replaceState(null, "", `${location.pathname}?${p}${location.hash}`);
  }

  /** 예상 시작일: 확정이면 실제 시작일, 아니면 초 5일·중순 15일·하순 25일 */
  function expectedStart(i, year) {
    if (i.confidence === "confirmed" && isDate(i.start)) return i.start;
    const d = { early: 5, mid: 15, late: 25 }[i.part] || 15;
    return `${year}-${String(i.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  function shift(iso, days) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
  const dot = (iso) => iso.replaceAll("-", ".");
  function today() {
    if (snap && isDate(String(snap.date))) return snap.date;
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  }

  function validItem(i) {
    return i && typeof i.name === "string" && CONFS.includes(i.confidence) && Number.isInteger(i.month)
      && i.month >= 1 && i.month <= 12 && PARTS.includes(i.part);
  }
  const visible = () => data.items.filter((i) => state.filter === "all" || i.confidence === "confirmed" || i.confidence === "high");

  function card(i) {
    const L = t();
    const when = i.confidence === "confirmed" && isDate(i.start) && isDate(i.end)
      ? `${i.start.replaceAll("-", ".")} – ${md(i.end)}`
      : L.expected(L.part[i.part], L.monthLong[i.month - 1]) + (Number.isInteger(i.duration_days) ? L.days(i.duration_days) : "");
    const past = (Array.isArray(i.history) ? i.history : []).filter((h) => isDate(h.start) && isDate(h.end)).slice(-4)
      .map((h) => `${h.y}: ${md(h.start)}–${md(h.end)}`).join(" · ");
    const link = safeUrl(i.link);
    return el("li", { class: "fest " + i.confidence },
      el("span", { class: "conf " + i.confidence, text: L.conf[i.confidence] }),
      el("h3", { text: i.name }),
      el("p", { class: "when", text: when }),
      el("p", { class: "where", text: [i.place, i.district].filter((x) => typeof x === "string" && x).join(" · ") }),
      (() => {
        const start = expectedStart(i, data.year);
        if (state.view === "biz") {
          const s = shift(start, -180);
          return el("p", { class: "plan" + (s < today() ? " late" : ""), text: L.bizDate(dot(s), s < today()) });
        }
        return el("p", { class: "plan", text: L.guideDates(dot(shift(start, -60)), dot(shift(start, -30))) });
      })(),
      basisEl(i),
      past ? el("p", { class: "past", text: `${L.past} ${past}` }) : null,
      i.lunar === true ? el("p", { class: "past", text: `※ ${L.lunar}` }) : null,
      link ? el("a", { class: "ext", href: link, target: "_blank", rel: "noopener noreferrer", text: L.official }) : null);
  }

  function basisEl(i) {
    const b = i.basis;
    if (!b || !Array.isArray(b.starts) || !b.starts.length) return null;
    const L = t();
    const md = (s) => (/^\d{2}-\d{2}$/.test(s) ? s.replace("-", ".") : "");   // 보고서 표기(04.27)
    const starts = b.starts.filter((s) => s && /^\d{2}-\d{2}$/.test(s.md)).map((s) => `${s.y}: ${md(s.md)}`).join(" · ");
    const mid = /^\d{2}-\d{2}$/.test(b.median || "") ? (b.method === "latest" ? L.basisLatest(md(b.median)) : L.basisMedian(md(b.median))) : "";
    return el("details", { class: "basis-detail" }, el("summary", { text: L.basisBtn }),
      el("ol", { class: "basis-steps" },
        el("li", { text: `${L.basisStarts}: ${starts}` }),
        el("li", { text: mid }),
        el("li", { text: L.basisPart(L.part[i.part], L.monthLong[i.month - 1]) }),
        el("li", {}, el("span", { class: "conf " + i.confidence, text: L.conf[i.confidence] }), document.createTextNode(` ${typeof b.reason === "string" ? b.reason.slice(0, 120) : ""}`))));
  }

  function renderBars() {
    const L = t();
    const counts = Array.from({ length: 12 }, (_, m) => data.items.filter((i) => i.month === m + 1).length);
    const max = Math.max(1, ...counts);
    const hot = counts[3] + counts[4];
    $("bars-title").textContent = L.bars;
    if (state.lang === "ko") $("bars-title").textContent = `${L.bars} (월)`;
    $("bars-note").textContent = L.barsNote(hot);
    $("bars").replaceChildren(...counts.map((n, m) => {
      const hi = m === 3 || m === 4;
      const bar = el("span", { class: "bar" + (hi ? " hi" : "") });
      bar.style.height = `${(n / max) * 100}%`;   // CSSOM(인라인 style 속성은 CSP로 막힘)
      return el("a", { class: "bar-col" + (hi ? " hi" : ""), href: `#m${m + 1}`, role: "listitem", "aria-label": `${L.monthLong[m]} ${L.count(n)}`, "data-tip": `${L.monthLong[m]} · ${L.count(n)}` },
        el("span", { class: "bar-val", text: hi ? String(n) : "" }), el("span", { class: "bar-track" }, bar), el("span", { class: "bar-lbl", text: state.lang === "ko" ? String(m + 1) : L.months[m] }));
    }));
    $("bars-table-toggle").textContent = L.barsTable;
    $("bars-table").replaceChildren(el("table", {}, el("tbody", {}, ...counts.map((n, m) => el("tr", {}, el("th", { text: L.monthLong[m] }), el("td", { text: String(n) }))))));
  }

  function renderFunnel() {
    const L = t();
    $("funnel-title").textContent = L.funnel;
    const f = data.funnel || {};
    const steps = ["records", "series", "recurring", "predicted"].filter((k) => Number.isInteger(f[k]));
    $("funnel").replaceChildren(...steps.map((k, i) => el("li", {},
      el("span", { class: "f-name", text: k === "predicted" ? `${data.year} ${L.funnelSteps[k]}` : L.funnelSteps[k] }),
      el("strong", { class: "f-num", text: f[k].toLocaleString(state.lang) }),
      i < steps.length - 1 ? el("span", { class: "f-arrow", "aria-hidden": "true", text: "→" }) : null)));
  }

  function render() {
    const L = t();
    document.documentElement.lang = state.lang;
    const year = data ? data.year : kstYear() + 1;
    document.title = `${L.title(year)} · Seoul Now`;
    $("site-title").textContent = L.title(year);
    $("site-sub").textContent = L.sub;
    $("back").textContent = L.back;
    $("back").href = `../?lang=${state.lang}`;
    $("about-title").textContent = L.aboutTitle;
    if (!data) return;
    const when = snap ? snap.events_at : data.generatedAt;
    const d = new Date(when);
    const stamp = isNaN(d) ? "-" : d.toLocaleString(state.lang === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }) + " KST";
    $("basis").textContent = snap ? L.basisSnap(stamp, snap.label) : L.basisLive(stamp);
    $("basis").classList.toggle("snap", !!snap);
    $("back").href = `../?lang=${state.lang}${snap ? `&snapshot=${snap.date}` : ""}`;
    renderFunnel();
    renderBars();
    $("view-chips").replaceChildren(...["guide", "biz"].map((k) =>
      el("button", { type: "button", class: "chip" + (state.view === k ? " active" : ""), "aria-pressed": String(state.view === k),
        onclick: () => { state.view = k; writeUrl(); render(); }, text: L.views[k] })));
    $("about-text").textContent = L.about(data.historyCount);
    $("legend").replaceChildren(...CONFS.map((c) => el("li", {},
      el("span", { class: "conf " + c, text: L.conf[c] }),
      el("span", { text: L.confHow[c] }),
      el("span", { class: "count", text: String(data.items.filter((i) => i.confidence === c).length) }))));
    $("conf-chips").replaceChildren(...[["all", L.all], ["likely", L.likely]].map(([k, label]) =>
      el("button", { type: "button", class: "chip" + (state.filter === k ? " active" : ""), "aria-pressed": String(state.filter === k),
        onclick: () => { state.filter = k; writeUrl(); render(); }, text: label })));

    const items = visible();
    const byMonth = Array.from({ length: 12 }, (_, m) => items.filter((i) => i.month === m + 1));
    $("month-nav").replaceChildren(...byMonth.map((list, m) =>
      el("a", { href: `#m${m + 1}`, class: list.length ? "" : "none", text: L.months[m] })));
    $("months").replaceChildren(...byMonth.map((list, m) => list.length
      ? el("section", { class: "month", id: `m${m + 1}` },
        el("h2", {}, document.createTextNode(L.monthLong[m]), el("small", { text: L.count(list.length) })),
        el("ul", { class: "fest-list" }, ...list.map(card)))
      : null).filter(Boolean));
    $("empty").textContent = L.none;
    $("empty").hidden = items.length > 0;
    $("updated").textContent = isDate(String(data.generatedAt).slice(0, 10)) ? L.updated(String(data.generatedAt).slice(0, 10)) : "";
    $("source").textContent = L.source;
  }

  async function init() {
    readUrl();
    render();
    if (state.snapshot) {
      try {
        const r = await fetch("../data/snapshots/index.json", { cache: "no-cache", credentials: "omit" });
        const idx = r.ok ? await r.json() : null;
        const hit = idx && Array.isArray(idx.snapshots) && idx.snapshots.find((x) => x && x.date === state.snapshot);
        if (hit) snap = { date: hit.date, label: String(hit.label || "").slice(0, 60), events_at: String(hit.events_at || "") };
      } catch { snap = null; }
    }
    const year = snap ? Number(snap.date.slice(0, 4)) + 1 : kstYear() + 1;
    try {
      const res = await fetch(`../data/${snap ? `snapshots/${snap.date}/` : ""}calendar_${year}.json`, { cache: "no-cache", credentials: "omit" });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      const items = Array.isArray(json.items) ? json.items.filter(validItem) : [];
      data = { year: Number.isInteger(json.year) ? json.year : year, items,
        historyCount: Number.isInteger(json.historyCount) ? json.historyCount : 0, generatedAt: String(json.generatedAt || ""),
        funnel: json.funnel && typeof json.funnel === "object" ? json.funnel : null };
      render();
      if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    } catch {
      $("empty").textContent = t().loadError;
      $("empty").hidden = false;
    }
  }

  init();
})();
