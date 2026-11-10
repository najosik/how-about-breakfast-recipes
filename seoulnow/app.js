// Seoul Now 프론트엔드. 백엔드(../seoul-now/data/*.json)를 읽어 목록·필터·상세를 그린다.
// 보안: 외부 데이터는 textContent로만 출력(innerHTML 미사용), 링크는 http/https만, 쿼리 값은 허용 목록 검증(lib.parseQuery).
// 개인정보: 수집·저장 없음. 브라우저 저장소에는 번역 동의(sessionStorage)만.
import * as L from "./lib.js?v=20261110c";
import { T } from "./i18n.js?v=20261110c";
import { initTranslate } from "./translate.js?v=20261110c";

const DATA = "../seoul-now/data/";
const $ = (id) => document.getElementById(id);
let today = L.kstToday();
let state = L.parseQuery(location.search, today);
let events = [];
let tags = {};
let stages = null;   // 행사 id → 0/1/2(선별 단계). 선별 데이터를 못 받으면 null
let meta = { updatedAt: "", loadedAt: null };
let shown = L.PAGE_SIZE;
const t = () => T[state.lang];
const filt = (s, omit = []) => L.filterEvents(events, s, today, omit, stages);

// ---------- DOM 도우미 ----------
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids) if (c != null && c !== false) n.append(c);
  return n;
}
const SVG = "http://www.w3.org/2000/svg";
const PATHS = {
  x: "M6 6l12 12M18 6L6 18", check: "M5 12.5l4.5 4.5L19 7.5", ext: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  cal: "M3.5 5h17v15h-17zM3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5", share: "M12 3v12M7.5 7.5L12 3l4.5 4.5M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1", back: "M15 6l-6 6 6 6", map: "M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z",
  perf: "M9 18V6l11-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z", exhibit: "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4",
  festival: "M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2l.9-5.5-4-3.9 5.5-.8z", edu: "M3 9l9-5 9 5-9 5zM7 11.2V16c3 2 7 2 10 0v-4.8",
  film: "M4 5h16v14H4zM4 9h16M4 15h16M8 5v14M16 5v14", other: "M5 12h.01M12 12h.01M19 12h.01",
};
function icon(name, label) {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("class", "ico"); s.setAttribute("viewBox", "0 0 24 24");
  if (label) { s.setAttribute("role", "img"); s.setAttribute("aria-label", label); } else s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG, "path"); p.setAttribute("d", PATHS[name] || ""); s.append(p);
  return s;
}
const guName = (code) => { const g = L.GU.get(code); return g ? (state.lang === "en" ? g.en : g.ko) : ""; };
const guLabel = (ko) => { const g = L.GU_BY_NAME.get(ko); return g ? (state.lang === "en" ? g.en : g.ko) : ko; };
const genreName = (code) => { const g = L.GENRES.find((x) => x.code === code); return g ? g[state.lang] : ""; };
function stampText(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return new Intl.DateTimeFormat(state.lang === "en" ? "en-US" : "ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}
function toast(msg) {
  const n = $("toast");
  n.textContent = msg; n.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => n.classList.remove("show"), 2400);
}

// ---------- 주소 동기화(필터 조작은 replaceState: 히스토리를 쌓지 않음) ----------
function syncUrl() {
  history.replaceState(history.state, "", location.pathname + L.toQuery({ ...state, event: null }));
}
function setState(patch) {
  state = L.normalizeState({ ...state, ...patch }, today);
  shown = L.PAGE_SIZE;
  syncUrl();
  renderList();
}

// ---------- 시트·패널: 열 때 첫 요소로 포커스, 포커스 가둠, Esc로 닫고 연 버튼으로 복귀 ----------
let openSheet = null;
function open(sheet, opener) {
  close();
  openSheet = { sheet, opener };
  $("scrim").hidden = false;
  sheet.hidden = false;
  // 데스크톱: 연 버튼 바로 아래 드롭다운(폭 480px, 화면 밖으로 나가지 않게). 모바일: 바텀시트(CSS)
  const desk = window.matchMedia("(min-width: 1024px)").matches && opener && sheet.id !== "tr-sheet";
  sheet.classList.toggle("drop", !!desk);
  if (desk) {
    const r = opener.getBoundingClientRect();
    const w = Math.min(480, window.innerWidth - 32);
    sheet.style.top = `${Math.round(r.bottom + 8)}px`;
    sheet.style.left = `${Math.round(Math.min(Math.max(16, r.left), window.innerWidth - w - 16))}px`;
    sheet.style.maxHeight = `${Math.max(240, Math.round(window.innerHeight - r.bottom - 24))}px`;
  } else { sheet.style.top = sheet.style.left = sheet.style.maxHeight = ""; }
  if (opener) opener.setAttribute("aria-expanded", "true");
  const first = sheet.querySelector("[aria-pressed='true'], input:checked, button, input, select, a[href]");
  (first || sheet).focus();
}
function close() {
  if (!openSheet) return;
  const { sheet, opener } = openSheet;
  openSheet = null;
  sheet.hidden = true;
  $("scrim").hidden = true;
  if (opener) { opener.setAttribute("aria-expanded", "false"); opener.focus(); }
}
document.addEventListener("keydown", (e) => {
  if (!openSheet) return;
  if (e.key === "Escape") { e.preventDefault(); close(); return; }
  if (e.key !== "Tab") return;
  const f = [...openSheet.sheet.querySelectorAll("button, input, select, a[href], [tabindex]:not([tabindex='-1'])")].filter((x) => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
$("scrim").addEventListener("click", close);
const sheetHead = (id, title) => [el("div", { class: "handle", "aria-hidden": "true" }),
  el("div", { class: "sheet-head" }, el("h2", { id, text: title }), el("button", { type: "button", class: "icon-btn", "aria-label": t().close, onclick: close }, icon("x")))];

// ---------- 머리글·고정 문구 ----------
function renderChrome() {
  const s = t();
  document.documentElement.lang = state.lang;
  $("skip").textContent = s.skip;
  $("cal-lbl").textContent = s.calendar;
  $("cal-link").setAttribute("aria-label", s.calendar);
  $("cal-link").href = `../seoul-now/calendar/${state.lang === "en" ? "?lang=en" : ""}`;
  $("logo").href = `./${state.lang === "en" ? "?lang=en" : ""}`;
  $("lang-group").setAttribute("aria-label", s.langGroup);
  for (const b of $("lang-group").querySelectorAll("button")) b.setAttribute("aria-current", String(b.dataset.lang === state.lang));
  $("tr-lbl").textContent = s.translate;
  $("tr-btn").setAttribute("aria-label", s.translate);
  $("tabs").setAttribute("aria-label", s.tabsLabel);
  $("month-lbl").textContent = s.monthLbl;
  $("gu-lbl").textContent = s.guLbl;
  $("genres").setAttribute("aria-label", s.genreGroup);
  $("sort-lbl").textContent = s.sort;
  $("ended-lbl").textContent = s.ended;
  $("more").textContent = s.more;
  $("foot-source").textContent = s.footSource;
  $("foot-contact").textContent = s.footContact;
  $("foot-tr").textContent = s.trNote;
  $("foot-stamp").textContent = meta.updatedAt ? s.updated(stampText(meta.updatedAt)) : "";
}

// ---------- 목록 ----------
function renderTabs() {
  const s = t();
  $("tabs").replaceChildren(...L.PERIODS.map((p) => {
    const n = filt({ ...state, period: p, month: null }).length;
    const on = !state.month && state.period === p;
    return el("a", { href: L.toQuery({ ...state, period: p, month: null, event: null }) || "./", "aria-current": on ? "page" : null,
      onclick: (e) => { e.preventDefault(); setState({ period: p, month: null }); } },
      s.tabs[p], el("span", { class: "tab-n", text: String(n) }));
  }));
  const wk = L.periodRange("weekend", today);
  const sub = $("tab-sub");
  sub.hidden = !(state.period === "weekend" && !state.month);
  sub.textContent = sub.hidden ? "" : `${L.formatShort(wk[0], state.lang)}–${L.formatShort(wk[1], state.lang)}`;
}

function renderFilterButtons() {
  const s = t();
  const mVal = state.month ? s.monthFull(state.month) : state.period === "month" ? `${s.thisMonth} (${s.monthName(L.monthOf(today))})` : s.allPeriod;
  $("month-val").textContent = mVal;
  $("month-btn").classList.toggle("on", !!state.month);
  $("month-btn").setAttribute("aria-label", s.monthBtnName(mVal));
  const gVal = !state.gu.length ? s.allSeoul : state.gu.length === 1 ? guName(state.gu[0]) : s.guMore(guName(state.gu[0]), state.gu.length - 1);
  $("gu-val").textContent = gVal;
  $("gu-btn").classList.toggle("on", state.gu.length > 0);
  $("gu-btn").setAttribute("aria-label", s.guBtnName(gVal));
  renderPicks();
  $("genres").replaceChildren(...L.GENRES.map((g) => {
    const on = state.genre.includes(g.code);
    return el("button", { type: "button", class: "chip", "aria-pressed": String(on),
      onclick: () => setState({ genre: on ? state.genre.filter((x) => x !== g.code) : [...state.genre, g.code] }) }, on ? icon("check") : null, g[state.lang]);
  }));
}

/** 선별 단계 필터(1차 관광 선별·2차 외국인 선별). 둘 중 하나만 고르는 토글. 건수는 다른 조건을 적용한 결과 */
function renderPicks() {
  const s = t();
  const box = $("picks");
  box.hidden = !stages;
  if (!stages) return;
  box.setAttribute("aria-label", s.pickGroup);
  $("picks-row").replaceChildren(el("span", { class: "picks-lbl", "aria-hidden": "true", text: s.pickLbl }), ...["s1", "s2"].map((k) => {
    const on = state.pick === k;
    const n = filt({ ...state, pick: k }).length;
    return el("button", { type: "button", class: "chip", "aria-pressed": String(on),
      onclick: () => setState({ pick: on ? "all" : k }) },
      on ? icon("check") : null, s.picks[k], el("span", { class: "chip-n", text: String(n) }));
  }));
  const note = $("pick-note");
  note.hidden = state.pick === "all";
  note.textContent = note.hidden ? "" : s.pickNote[state.pick];
}

function renderApplied() {
  const s = t();
  const chips = [];
  const chip = (label, onRemove) => el("button", { type: "button", class: "chip", "aria-label": s.remove(label), onclick: onRemove }, label, icon("x"));
  if (state.month) chips.push(chip(s.monthFull(state.month), () => setState({ month: null, period: "month" })));
  for (const g of state.gu) chips.push(chip(guName(g), () => setState({ gu: state.gu.filter((x) => x !== g) })));
  for (const g of state.genre) chips.push(chip(genreName(g), () => setState({ genre: state.genre.filter((x) => x !== g) })));
  if (stages && state.pick !== "all") chips.push(chip(s.picks[state.pick], () => setState({ pick: "all" })));
  if (chips.length) chips.push(el("button", { type: "button", class: "btn-text", text: s.resetAll, onclick: () => setState({ month: null, period: "month", gu: [], genre: [], pick: "all" }) }));
  $("applied").replaceChildren(...chips);
}

/** 선별 통과 배지: 2차 통과는 '외국인 추천'(1차도 통과한 상태), 1차만 통과는 '관광 추천' */
function pickBadge(ev) {
  const lv = stages ? stages.get(ev.id) || 0 : 0;
  if (!lv) return null;
  const k = lv >= 2 ? "s2" : "s1";
  return el("span", { class: `pick-badge ${k}`, title: t().pickNote[k], text: t().picks[k] });
}

function card(ev) {
  const s = t();
  const st = L.statusOf(ev, today);
  const badgeText = st.key === "dday" ? s.badge.dday(st.days) : s.badge[st.key];
  const thumb = el("span", { class: "thumb" });
  const src = L.safeUrl(ev.image);
  const placeholder = () => icon(L.genreOf(ev.category));
  if (src) {
    const img = el("img", { src, alt: "", width: "96", height: "96", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img.replaceWith(placeholder()), { once: true });
    thumb.append(img);
  } else thumb.append(placeholder());
  thumb.append(el("span", { class: `status ${st.key}`, text: badgeText }));
  const href = L.toQuery({ ...state, event: ev.id });
  return el("li", {}, el("a", { class: "card", href, onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); goDetail(ev.id); } },
    thumb,
    el("span", { class: "card-body" },
      el("span", { class: "card-top" }, el("span", { class: "genre", text: genreName(L.genreOf(ev.category)) }), pickBadge(ev)),
      el("span", { class: "title", text: ev.title }),
      el("span", { class: "meta", text: L.formatRange(ev.start, ev.end, state.lang) }),
      el("span", { class: "meta place", text: [guLabel(ev.district), ev.place].filter(Boolean).join(" · ") }),
      el("span", { class: "fee", text: ev.free ? s.free : s.paid }))));
}

function renderList() {
  if (state.event) return;
  const s = t();
  renderChrome();
  renderTabs();
  renderFilterButtons();
  renderApplied();
  const hasReg = events.some((e) => e.registered);
  $("sort").replaceChildren(...L.SORTS.filter((k) => k !== "recent" || hasReg).map((k) => el("option", { value: k, text: s.sorts[k] })));
  $("sort").value = state.sort === "recent" && !hasReg ? "date" : state.sort;
  $("ended").checked = state.ended;
  const list = L.sortEvents(filt(state), state.sort, today);
  $("count").textContent = s.count(list.length);
  $("stamp").textContent = meta.updatedAt ? s.updated(stampText(meta.updatedAt)) : "";
  $("list").replaceChildren(...list.slice(0, shown).map(card));
  $("more").hidden = list.length <= shown;
  $("state").replaceChildren(...(list.length ? [] : [emptyState()]));
  document.title = s.docTitle;
}

/** 빈 결과: 실제로 결과가 있는 조건만 다음 행동으로 제시 */
function emptyState() {
  const s = t();
  const acts = [];
  if (state.gu.length && filt(state, ["gu"]).length) acts.push(el("button", { type: "button", class: "btn", text: s.emptyAllGu, onclick: () => setState({ gu: [] }) }));
  if (stages && state.pick !== "all" && filt(state, ["pick"]).length) acts.push(el("button", { type: "button", class: "btn", text: s.emptyAllPick, onclick: () => setState({ pick: "all" }) }));
  const months = L.monthsAhead(today, 12);
  const cur = state.month || (state.period === "month" ? L.monthOf(today) : null);
  const next = cur ? months[months.indexOf(cur) + 1] : null;
  if (next && filt({ ...state, period: "all", month: next }).length) acts.push(el("button", { type: "button", class: "btn", text: s.emptyNext, onclick: () => setState({ period: "all", month: next }) }));
  acts.push(el("button", { type: "button", class: "btn primary", text: s.emptyReset, onclick: () => setState({ month: null, period: "month", gu: [], genre: [], pick: "all" }) }));
  const summary = [$("month-val").textContent, $("gu-val").textContent, ...state.genre.map(genreName), ...(stages && state.pick !== "all" ? [s.picks[state.pick]] : [])].join(" · ");
  return el("div", { class: "notice" }, el("h2", { text: s.empty }), el("p", { text: summary }), el("div", { class: "acts" }, ...acts));
}

// ---------- 월 선택 패널(왼쪽): 오늘부터 12개월 + 건수, 탭 즉시 적용 ----------
function openMonthPanel() {
  const s = t();
  const p = $("month-panel");
  const cells = [];
  const pick = (patch) => { setState(patch); close(); };
  const allN = filt({ ...state, period: "all", month: null }).length;
  cells.push(el("button", { type: "button", class: "mcell wide", "aria-pressed": String(!state.month && state.period === "all"),
    onclick: () => pick({ period: "all", month: null }) }, el("b", { text: s.allPeriod }), el("span", { class: "n", text: s.nCount(allN) })));
  let year = today.slice(0, 4);
  for (const ym of L.monthsAhead(today, 12)) {
    if (ym.slice(0, 4) !== year) { year = ym.slice(0, 4); cells.push(el("p", { class: "year", text: year })); }
    const isThis = ym === L.monthOf(today);
    const n = filt({ ...state, period: "all", month: isThis ? null : ym, ...(isThis ? { period: "month" } : {}) }).length;
    const on = isThis ? (!state.month && state.period === "month") : state.month === ym;
    cells.push(el("button", { type: "button", class: "mcell", "aria-pressed": String(on), "aria-label": `${s.monthFull(ym)} ${s.nCount(n)}`,
      onclick: () => pick(isThis ? { period: "month", month: null } : { period: "all", month: ym }) },
      el("b", { text: s.monthName(ym) }), isThis ? el("span", { class: "tag", text: s.thisMonth }) : null, el("span", { class: "n", text: s.nCount(n) })));
  }
  p.replaceChildren(...sheetHead("month-title", s.monthLbl), el("div", { class: "sheet-body" }, el("div", { class: "months" }, ...cells)));
  open(p, $("month-btn"));
}

// ---------- 자치구 바텀시트(오른쪽): 5개 생활권역, 다중선택, 확인 후 적용 ----------
function openGuSheet() {
  const s = t();
  const p = $("gu-sheet");
  let pickd = new Set(state.gu);
  const counts = new Map();
  for (const ev of filt(state, ["gu"])) counts.set(ev.district, (counts.get(ev.district) || 0) + 1);
  const total = () => filt({ ...state, gu: [...pickd] }).length;
  const apply = el("button", { type: "button", class: "btn primary", onclick: () => { setState({ gu: [...pickd] }); close(); } });
  const body = el("div", { class: "sheet-body" });
  const draw = () => {
    apply.textContent = s.sheetApply(total());
    const all = el("label", { class: "gu-chip" }, el("input", { type: "checkbox", checked: pickd.size === 0, onchange: () => { pickd = new Set(); draw(); } }), s.allSeoul);
    body.replaceChildren(el("div", { class: "gus" }, all), ...L.AREAS.map((a) => {
      const codes = a.gu.map(([c]) => c);
      const full = codes.every((c) => pickd.has(c));
      return el("div", { class: "area" },
        el("button", { type: "button", class: "area-h", "aria-pressed": String(full),
          onclick: () => { codes.forEach((c) => (full ? pickd.delete(c) : pickd.add(c))); draw(); } }, full ? icon("check") : null, a[state.lang]),
        el("div", { class: "gus" }, ...a.gu.map(([code, ko, en]) => el("label", { class: "gu-chip" },
          el("input", { type: "checkbox", checked: pickd.has(code), onchange: (e) => { e.target.checked ? pickd.add(code) : pickd.delete(code); draw(); } }),
          state.lang === "en" ? en : ko, el("span", { class: "n", text: String(counts.get(ko) || 0) })))));
    }));
  };
  draw();
  p.replaceChildren(...sheetHead("gu-title", s.guLbl), body,
    el("div", { class: "sheet-foot" }, el("button", { type: "button", class: "btn", text: s.sheetReset, onclick: () => { pickd = new Set(); draw(); } }), apply));
  open(p, $("gu-btn"));
}

// ---------- 상세 ----------
function goDetail(id) {
  history.replaceState({ ...(history.state || {}), scroll: window.scrollY, shown }, "", location.href);
  history.pushState({ detail: true }, "", location.pathname + L.toQuery({ ...state, event: id }));
  state = { ...state, event: id };
  render();
  window.scrollTo(0, 0);
}
function backToList() {
  if (history.state && history.state.detail) history.back();
  else { state = { ...state, event: null }; history.replaceState(null, "", location.pathname + L.toQuery({ ...state, event: null })); render(); }
}

function renderDetail() {
  const s = t();
  const ev = events.find((e) => e.id === state.event);
  const view = $("detail-view");
  if (!ev) {
    view.replaceChildren(el("div", { class: "notice" }, el("h2", { text: s.empty }),
      el("div", { class: "acts" }, el("button", { type: "button", class: "btn primary", text: s.back, onclick: backToList }))));
    return;
  }
  document.title = `${ev.title} · Seoul Now`;
  const st = L.statusOf(ev, today);
  const shareUrl = `${location.origin}${location.pathname}?event=${ev.id}`;
  const hero = el("figure", { class: "hero" });
  const src = L.safeUrl(ev.image);
  if (src) {
    const img = el("img", { src, alt: s.imgAlt(ev.title), width: "1280", height: "720", decoding: "async", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img.replaceWith(icon(L.genreOf(ev.category))), { once: true });
    hero.append(img);
  } else hero.append(icon(L.genreOf(ev.category)));
  const tag = tags[ev.id];
  const booking = tag && s.bookingVal[tag.reservation_barrier] ? s.bookingVal[tag.reservation_barrier] : s.bookingVal.none;
  const fact = (k, v) => (v ? el("div", {}, el("dt", { text: k }), el("dd", { text: v })) : null);
  const official = L.safeUrl(ev.link || ev.homepage);
  const ics = () => {
    const blob = new Blob([L.toIcs(ev, shareUrl)], { type: "text/calendar" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `seoulnow-${ev.id}.ics` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const copy = async (text, ok) => {
    try { await navigator.clipboard.writeText(text); toast(ok); } catch { toast(s.copyFail); }
  };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: ev.title, url: shareUrl }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    copy(shareUrl, s.copied);
  };
  const addr = [guLabel(ev.district), ev.place].filter(Boolean).join(" ");
  const aboutParts = [[s.program, ev.program], [s.performers, ev.player], [s.notes, ev.etc]].filter(([, v]) => v);
  const maps = [];
  maps.push(el("a", { class: "btn", href: `https://map.naver.com/p/search/${encodeURIComponent(ev.place || addr)}`, target: "_blank", rel: "noopener noreferrer", "aria-label": `${s.naverMap} ${s.newWin}` }, icon("map"), s.naverMap));
  if (Number.isFinite(ev.lat) && Number.isFinite(ev.lng)) {
    maps.push(el("a", { class: "btn", href: `https://map.kakao.com/link/map/${encodeURIComponent((ev.place || "").replace(/,/g, " "))},${ev.lat},${ev.lng}`, target: "_blank", rel: "noopener noreferrer", "aria-label": `${s.kakaoMap} ${s.newWin}` }, icon("map"), s.kakaoMap));
  }
  // 함께 볼 만한 행사: 같은 자치구 또는 같은 주말
  const wk = L.periodRange("weekend", today);
  const related = L.sortEvents(events.filter((e) => e.id !== ev.id && e.end >= today && (e.district === ev.district || L.overlaps(e, wk))), "date", today).slice(0, 3);
  view.replaceChildren(
    el("a", { class: "back", href: L.toQuery({ ...state, event: null }) || "./", onclick: (e) => { e.preventDefault(); backToList(); } }, icon("back"), s.back),
    hero,
    el("div", { class: "d-meta" }, el("span", { class: "genre", text: genreName(L.genreOf(ev.category)) }),
      el("span", { class: `status ${st.key}`, text: st.key === "dday" ? s.badge.dday(st.days) : s.badge[st.key] }), pickBadge(ev)),
    el("h1", { text: ev.title }),
    stages && stages.get(ev.id) ? el("p", { class: "pick-note", text: s.pickNote[stages.get(ev.id) >= 2 ? "s2" : "s1"] }) : null,
    el("dl", { class: "facts" },
      fact(s.period, L.formatRange(ev.start, ev.end, state.lang)),
      fact(s.hours, s.hoursNote),
      fact(s.place, [guLabel(ev.district), ev.place].filter(Boolean).join(" · ")),
      fact(s.fee, ev.free ? s.free : (ev.fee || s.paid)),
      fact(s.target, ev.target),
      fact(s.booking, booking)),
    el("div", { class: "d-actions" },
      official ? el("a", { class: "btn primary", href: official, target: "_blank", rel: "noopener noreferrer", "aria-label": `${s.official} ${s.newWin}` }, s.official, icon("ext")) : null,
      el("button", { type: "button", class: "btn", onclick: ics }, icon("cal"), s.addCal),
      el("button", { type: "button", class: "btn", onclick: share }, icon("share"), s.share)),
    el("section", {}, el("h2", { text: s.about }),
      ...(aboutParts.length ? aboutParts.map(([k, v]) => el("p", {}, el("strong", { text: `${k} ` }), v)) : [el("p", { text: s.noAbout })])),
    el("section", {}, el("h2", { text: s.route }),
      el("div", { class: "addr" }, el("span", { text: addr }), el("button", { type: "button", class: "btn", onclick: () => copy(addr, s.addrCopied) }, icon("copy"), s.copyAddr)),
      el("div", { class: "d-actions" }, ...maps)),
    el("p", { class: "src", text: `${s.source} · ${meta.updatedAt ? s.updated(stampText(meta.updatedAt)) : ""}` }),
    related.length ? el("section", { class: "related" }, el("h2", { text: s.related }), el("ul", { class: "cards" }, ...related.map(card))) : null);
}

// ---------- 화면 전환 ----------
function render() {
  today = L.kstToday();
  renderChrome();
  const detail = !!state.event;
  $("list-view").hidden = detail;
  $("detail-view").hidden = !detail;
  if (detail) renderDetail(); else renderList();
}
window.addEventListener("popstate", () => {
  state = L.parseQuery(location.search, today);
  const st = history.state || {};
  shown = Number.isInteger(st.shown) ? st.shown : L.PAGE_SIZE;
  render();
  if (!state.event && Number.isFinite(st.scroll)) setTimeout(() => window.scrollTo(0, st.scroll), 0);   // 목록 위치 복원
});

// 뒤로가기 위치는 직접 복원(브라우저 자동 복원은 목록을 다시 그리기 전에 스크롤해 어긋남)
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

// ---------- 데이터 ----------
async function load() {
  const skeletonTimer = setTimeout(() => {   // 300ms 미만이면 스켈레톤을 보이지 않음
    $("state").replaceChildren(el("ul", { class: "skeleton", "aria-hidden": "true" }, el("li"), el("li"), el("li")));
  }, 300);
  try {
    const res = await fetch(`${DATA}events.json`, { cache: "no-cache", credentials: "omit" });
    if (!res.ok) throw new Error("http");
    const json = await res.json();
    events = Array.isArray(json.events) ? json.events.filter(L.validEvent) : [];
    meta = { updatedAt: String(json.updatedAt || ""), loadedAt: new Date() };
    clearTimeout(skeletonTimer);
    $("state").replaceChildren();
    render();
    // 선별 결과(1·2차)와 분류 태그(예매 필요 여부). 실패해도 목록은 그대로(선별 필터만 숨김)
    const get = (f) => fetch(`${DATA}${f}`, { cache: "no-cache", credentials: "omit" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get("tourism_select.json"), get("festival_tags.json"), get("festival_overrides.json")]).then(([sel, tg, ov]) => {
      if (tg && tg.tags && typeof tg.tags === "object") tags = tg.tags;
      stages = L.buildStages(events, sel, tags, ov);
      render();
    });
  } catch {
    clearTimeout(skeletonTimer);
    const s = t();
    renderChrome();
    $("state").replaceChildren(el("div", { class: "notice", role: "alert" }, el("h2", { text: s.error }),
      meta.loadedAt ? el("p", { text: s.lastLoaded(stampText(meta.loadedAt.toISOString())) }) : null,
      el("div", { class: "acts" }, el("button", { type: "button", class: "btn primary", text: s.retry, onclick: load }))));
  }
}

// ---------- 이벤트 연결 ----------
$("month-btn").addEventListener("click", openMonthPanel);
$("gu-btn").addEventListener("click", openGuSheet);
$("sort").addEventListener("change", (e) => setState({ sort: L.SORTS.includes(e.target.value) ? e.target.value : "date" }));
$("ended").addEventListener("change", (e) => setState({ ended: e.target.checked }));
$("more").addEventListener("click", () => {
  const before = shown;
  shown += L.PAGE_SIZE; renderList();
  const next = $("list").children[before];
  if (next) next.querySelector("a").focus();   // 새로 나온 첫 카드로 포커스
});
for (const b of $("lang-group").querySelectorAll("button")) {
  b.addEventListener("click", () => { state = { ...state, lang: b.dataset.lang === "en" ? "en" : "ko" }; syncUrl(); if (state.event) history.replaceState(history.state, "", location.pathname + L.toQuery(state)); render(); });
}
$("logo").addEventListener("click", (e) => { e.preventDefault(); state = L.parseQuery(state.lang === "en" ? "?lang=en" : "", today); shown = L.PAGE_SIZE; history.pushState(null, "", location.pathname + L.toQuery(state)); render(); window.scrollTo(0, 0); });
$("skip").addEventListener("click", (e) => { e.preventDefault(); $("main").focus(); });

// 필터 바: 상단 고정 + 모바일에서 아래로 스크롤하면 장르 줄을 접어 고정 영역을 화면 30% 이하로
let lastY = 0;
window.addEventListener("scroll", () => {
  const fb = $("filterbar");
  const y = window.scrollY;
  fb.classList.toggle("stuck", fb.getBoundingClientRect().top <= 0 && y > 0);
  if (Math.abs(y - lastY) > 8) { fb.classList.toggle("compact", y > lastY && y > 200); lastY = y; }
}, { passive: true });

// 오프라인 배너
const offline = () => { $("offline").textContent = t().offline; $("offline").hidden = navigator.onLine; };
window.addEventListener("offline", offline);
window.addEventListener("online", () => { offline(); load(); });

renderChrome();
offline();
initTranslate({ button: $("tr-btn"), sheet: $("tr-sheet"), bar: $("tr-bar"), pick: $("tr-pick"), original: $("tr-original"),
  strings: () => t(), lang: () => state.lang, open, close, sheetHead, el });
load();
