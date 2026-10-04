// 서울 축제 예상 캘린더 — data/calendar_<연도>.json 표시
// 보안: 외부 데이터는 textContent로만 출력(innerHTML 미사용), 링크는 http/https만 허용.
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const CONFS = ["confirmed", "high", "medium", "low"];
  const PARTS = ["early", "mid", "late"];
  const T = {
    en: {
      title: (y) => `${y} Seoul Festival Calendar`,
      sub: "When Seoul's recurring festivals are likely to happen next year, based on past years",
      back: "← What's On in Seoul",
      aboutTitle: "How this forecast works",
      about: (n) => `We grouped ${n.toLocaleString("en")} festivals from the last five years by name and looked at when each one was held. Only festivals held in at least two different years, including at least once in the last two years, are shown. Dates are estimates — always check the official page before you go.`,
      conf: { confirmed: "Confirmed", high: "Likely", medium: "Probable", low: "Uncertain" },
      confHow: {
        confirmed: "Next year's dates are already published",
        high: "Held 3+ years, start dates within 3 weeks",
        medium: "Held 2+ years, start dates within 5 weeks",
        low: "Recurring, but timing varies",
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
    },
    ko: {
      title: (y) => `${y} 서울 축제 예상 캘린더`,
      sub: "지난 개최 시기로 예측한 내년 서울 반복 축제 일정",
      back: "← 서울에서 지금 뭐하지",
      aboutTitle: "예측 방법",
      about: (n) => `최근 5년간의 축제 ${n.toLocaleString("ko")}건을 이름으로 묶어 해마다 언제 열렸는지 살폈습니다. 2개 연도 이상 열렸고 최근 2년 안에 한 번 이상 열린 축제만 보여 줍니다. 날짜는 추정이므로 방문 전 반드시 공식 페이지를 확인하세요.`,
      conf: { confirmed: "확정", high: "예상 높음", medium: "예상 보통", low: "예상 낮음" },
      confHow: {
        confirmed: "내년 일정이 이미 공개됨",
        high: "3년 이상 개최, 시작일 차이 3주 이내",
        medium: "2년 이상 개최, 시작일 차이 5주 이내",
        low: "반복 개최되지만 시기가 들쭉날쭉",
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
    },
  };
  const state = { lang: "en", filter: "all" };
  let data = null;
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
      : (navigator.language || "").toLowerCase().startsWith("ko") ? "ko" : "en";
    if (p.get("show") === "likely") state.filter = "likely";
  }
  function writeUrl() {
    const p = new URLSearchParams({ lang: state.lang });
    if (state.filter !== "all") p.set("show", state.filter);
    history.replaceState(null, "", `${location.pathname}?${p}${location.hash}`);
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
      past ? el("p", { class: "past", text: `${L.past} ${past}` }) : null,
      i.lunar === true ? el("p", { class: "past", text: `※ ${L.lunar}` }) : null,
      link ? el("a", { class: "ext", href: link, target: "_blank", rel: "noopener noreferrer", text: L.official }) : null);
  }

  function render() {
    const L = t();
    document.documentElement.lang = state.lang;
    const year = data ? data.year : kstYear() + 1;
    document.title = `${L.title(year)} · ${state.lang === "ko" ? "Seoul Festival Calendar" : "서울 축제 캘린더"}`;
    $("site-title").textContent = L.title(year);
    $("site-sub").textContent = L.sub;
    $("back").textContent = L.back;
    $("back").href = `../?lang=${state.lang}`;
    $("lang-toggle").textContent = L.langToggle;
    $("about-title").textContent = L.aboutTitle;
    if (!data) return;
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
    $("lang-toggle").addEventListener("click", () => { state.lang = state.lang === "en" ? "ko" : "en"; writeUrl(); render(); });
    render();
    const year = kstYear() + 1;
    try {
      const res = await fetch(`../data/calendar_${year}.json`, { cache: "no-cache", credentials: "omit" });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      const items = Array.isArray(json.items) ? json.items.filter(validItem) : [];
      data = { year: Number.isInteger(json.year) ? json.year : year, items,
        historyCount: Number.isInteger(json.historyCount) ? json.historyCount : 0, generatedAt: String(json.generatedAt || "") };
      render();
      if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    } catch {
      $("empty").textContent = t().loadError;
      $("empty").hidden = false;
    }
  }

  init();
})();
