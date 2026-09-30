// 서울에서 지금 뭐하지 — 메인 로직
// 보안: 외부 데이터는 textContent로만 출력(innerHTML 미사용), URL은 http/https만 허용.
"use strict";

(() => {
  const PAGE = 24;
  const WHEN = ["today", "weekend", "week", "month", "all"];
  const SORTS = ["ending", "starting"];
  const $ = (id) => document.getElementById(id);

  const state = {
    lang: "en", when: "week", cat: "all", gu: "", free: false, q: "", sort: "ending",
    shown: PAGE,
  };
  let data = { events: [] };
  let filtered = [];

  // ---------- 유틸 ----------
  const t = (k, ...a) => {
    const v = I18N[state.lang][k];
    return typeof v === "function" ? v(...a) : v;
  };

  /** 한국 시간(Asia/Seoul) 기준 오늘 날짜 'YYYY-MM-DD' */
  function kstToday() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
  }
  function addDays(iso, n) {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function weekday(iso) { return new Date(iso + "T00:00:00Z").getUTCDay(); }

  function range(when, today) {
    switch (when) {
      case "today": return [today, today];
      case "weekend": {
        const wd = weekday(today);
        if (wd === 0) return [today, today];               // 일요일
        const sat = addDays(today, (6 - wd + 7) % 7);        // 토요일(당일 포함)
        return [wd === 6 ? today : sat, addDays(sat, 1)];
      }
      case "week": return [today, addDays(today, 6)];
      case "month": return [today, addDays(today, 29)];
      default: return [today, "9999-12-31"];
    }
  }

  function fmtDate(iso) {
    const d = new Date(iso + "T00:00:00Z");
    return new Intl.DateTimeFormat(state.lang === "ko" ? "ko-KR" : "en-US", {
      timeZone: "UTC", month: "short", day: "numeric", weekday: "short",
    }).format(d);
  }
  function fmtRange(ev) {
    return ev.start === ev.end ? fmtDate(ev.start) : `${fmtDate(ev.start)} – ${fmtDate(ev.end)}`;
  }

  function safeUrl(u) {
    if (typeof u !== "string" || !u) return "";
    try {
      const p = new URL(u);
      return p.protocol === "https:" || p.protocol === "http:" ? p.href : "";
    } catch { return ""; }
  }

  function groupOf(cat) {
    for (const g of CATEGORY_GROUPS) {
      if (g.match && g.match.includes(cat)) return g.id;
      if (g.prefix && cat.startsWith(g.prefix)) return g.id;
    }
    return "other";
  }
  const catLabel = (c) => (state.lang === "en" ? CATEGORY_EN[c] || c : c);
  const guLabel = (g) => (state.lang === "en" ? DISTRICT_EN[g] || g : g);

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

  function extLink(href, label) {
    const u = safeUrl(href);
    return u ? el("a", { href: u, target: "_blank", rel: "noopener noreferrer", class: "ext", text: label }) : null;
  }

  // ---------- URL 상태 (화이트리스트 검증) ----------
  function readUrl() {
    const p = new URLSearchParams(location.search);
    const lang = p.get("lang");
    if (lang === "ko" || lang === "en") state.lang = lang;
    else state.lang = (navigator.language || "").toLowerCase().startsWith("ko") ? "ko" : "en";
    if (WHEN.includes(p.get("when"))) state.when = p.get("when");
    const cat = p.get("cat");
    if (cat && CATEGORY_GROUPS.some((g) => g.id === cat)) state.cat = cat;
    const gu = p.get("gu");
    if (gu && Object.hasOwn(DISTRICT_EN, gu)) state.gu = gu;
    state.free = p.get("free") === "1";
    if (SORTS.includes(p.get("sort"))) state.sort = p.get("sort");
    state.q = (p.get("q") || "").slice(0, 50);
  }
  function writeUrl() {
    const p = new URLSearchParams();
    p.set("lang", state.lang);
    if (state.when !== "week") p.set("when", state.when);
    if (state.cat !== "all") p.set("cat", state.cat);
    if (state.gu) p.set("gu", state.gu);
    if (state.free) p.set("free", "1");
    if (state.sort !== "ending") p.set("sort", state.sort);
    if (state.q) p.set("q", state.q);
    history.replaceState(null, "", `${location.pathname}?${p}`);
  }

  // ---------- 필터 ----------
  function applyFilters() {
    const today = kstToday();
    const [from, to] = range(state.when, today);
    const q = state.q.trim().toLowerCase();
    filtered = data.events.filter((ev) => {
      if (ev.end < from || ev.start > to) return false;
      if (state.cat !== "all" && groupOf(ev.category) !== state.cat) return false;
      if (state.gu && ev.district !== state.gu) return false;
      if (state.free && !ev.free) return false;
      if (q) {
        const hay = `${ev.title} ${ev.place} ${ev.org} ${ev.category} ${CATEGORY_EN[ev.category] || ""} ${DISTRICT_EN[ev.district] || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const key = state.sort === "starting" ? "start" : "end";
    filtered.sort((a, b) => a[key].localeCompare(b[key]) || a.title.localeCompare(b.title));
  }

  // ---------- 렌더링 ----------
  function renderStatic() {
    document.documentElement.lang = state.lang;
    $("site-title").textContent = t("siteTitle");
    $("site-sub").textContent = t("siteSub");
    $("lang-toggle").textContent = t("langToggle");
    $("lbl-when").textContent = t("when");
    $("lbl-type").textContent = t("type");
    $("lbl-search").textContent = t("search");
    $("lbl-district").textContent = t("district");
    $("lbl-sort").textContent = t("sort");
    $("lbl-free").textContent = t("freeOnly");
    $("q").placeholder = t("searchPh");
    $("q").value = state.q;
    $("free").checked = state.free;
    $("reset").textContent = t("reset");
    $("more").textContent = t("more");
    $("ko-note").textContent = t("koNote");
    $("ko-note").hidden = !t("koNote");
    $("source").textContent = t("source");
    $("d-close").setAttribute("aria-label", t("close"));
    $("demo-banner").textContent = t("demo");
    $("demo-banner").hidden = !data.demo;
    if (data.updatedAt) {
      const d = new Date(data.updatedAt);
      $("updated").textContent = isNaN(d) ? "" : t("updated", d.toLocaleString(state.lang === "ko" ? "ko-KR" : "en-US",
        { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }) + " KST");
    }

    const whenLabels = { today: "whenToday", weekend: "whenWeekend", week: "whenWeek", month: "whenMonth", all: "whenAll" };
    $("when-chips").replaceChildren(...WHEN.map((w) => chip(t(whenLabels[w]), state.when === w, () => { state.when = w; update(); })));
    const cats = [{ id: "all", label: t("catAll") }, ...CATEGORY_GROUPS.map((g) => ({ id: g.id, label: g[state.lang] }))];
    $("cat-chips").replaceChildren(...cats.map((c) => chip(c.label, state.cat === c.id, () => { state.cat = c.id; update(); })));

    const gus = [...new Set(data.events.map((e) => e.district).filter((g) => Object.hasOwn(DISTRICT_EN, g)))]
      .sort((a, b) => guLabel(a).localeCompare(guLabel(b)));
    $("district").replaceChildren(el("option", { value: "", text: t("districtAll") }),
      ...gus.map((g) => el("option", { value: g, text: guLabel(g) })));
    $("district").value = state.gu;
    $("sort").replaceChildren(el("option", { value: "ending", text: t("sortEnding") }),
      el("option", { value: "starting", text: t("sortStarting") }));
    $("sort").value = state.sort;
  }

  function chip(label, active, onClick) {
    return el("button", { type: "button", class: "chip" + (active ? " active" : ""), "aria-pressed": String(active), onclick: onClick, text: label });
  }

  function badges(ev, today) {
    const wrap = el("div", { class: "badges" });
    wrap.append(el("span", { class: "badge " + (ev.free ? "free" : "paid"), text: ev.free ? t("free") : t("paid") }));
    if (ev.end === today) wrap.append(el("span", { class: "badge hot", text: t("endsToday") }));
    else if (ev.start <= today) wrap.append(el("span", { class: "badge on", text: t("ongoing") }));
    return wrap;
  }

  function thumb(ev, cls) {
    const box = el("div", { class: cls + " cat-" + groupOf(ev.category) });
    const src = safeUrl(ev.image);
    if (src) {
      const img = el("img", { src, alt: "", loading: "lazy", decoding: "async" });
      img.addEventListener("error", () => { img.remove(); box.classList.add("noimg"); }, { once: true });
      box.append(img);
    } else {
      box.classList.add("noimg");
    }
    return box;
  }

  function card(ev, today) {
    const btn = el("button", { type: "button", class: "card", onclick: () => openDetail(ev) },
      thumb(ev, "thumb"),
      el("div", { class: "card-body" },
        el("p", { class: "meta", text: `${catLabel(ev.category)} · ${guLabel(ev.district)}` }),
        el("h2", { class: "title", text: ev.title }),
        el("p", { class: "date", text: fmtRange(ev) }),
        el("p", { class: "place", text: ev.place }),
        badges(ev, today)));
    return el("li", {}, btn);
  }

  function renderList() {
    const today = kstToday();
    $("count").textContent = t("results", filtered.length);
    $("list").replaceChildren(...filtered.slice(0, state.shown).map((ev) => card(ev, today)));
    $("empty").textContent = t("none");
    $("empty").hidden = filtered.length > 0;
    $("more").hidden = filtered.length <= state.shown;
  }

  function row(label, value) {
    return value ? el("div", { class: "row" }, el("dt", { text: label }), el("dd", { text: value })) : null;
  }

  function openDetail(ev) {
    const today = kstToday();
    const mapQuery = ev.lat && ev.lng ? `${ev.lat},${ev.lng}` : `${ev.place} ${ev.district} 서울`;
    const official = safeUrl(ev.link);
    const links = el("div", { class: "links" },
      extLink(official, t("official")),
      state.lang === "en" && official
        ? extLink(`https://translate.google.com/translate?sl=ko&tl=en&u=${encodeURIComponent(official)}`, t("translate"))
        : null,
      extLink(ev.homepage, t("homepage")),
      extLink(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`, t("googleMap")),
      extLink(`https://map.naver.com/p/search/${encodeURIComponent(ev.place + " " + ev.district)}`, t("naverMap")));

    $("d-body").replaceChildren(
      thumb(ev, "d-thumb"),
      el("p", { class: "meta", text: `${catLabel(ev.category)} · ${guLabel(ev.district)}` }),
      el("h2", { id: "d-title", class: "d-title", text: ev.title }),
      badges(ev, today),
      el("dl", { class: "facts" },
        row(t("period"), fmtRange(ev)),
        row(t("schedule"), ev.dateText !== `${ev.start}~${ev.end}` ? ev.dateText : ""),
        row(t("venue"), ev.place),
        row(t("fee"), ev.fee || (ev.free ? t("free") : "")),
        row(t("audience"), ev.target),
        row(t("organizer"), ev.org),
        row(t("performers"), ev.player),
        row(t("program"), ev.program),
        row(t("notes"), ev.etc)),
      links);
    const dlg = $("detail");
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
  }

  function update() {
    state.shown = PAGE;
    writeUrl();
    renderStatic();
    applyFilters();
    renderList();
  }

  // ---------- 이벤트 ----------
  function bind() {
    let timer;
    $("q").addEventListener("input", (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.q = e.target.value.slice(0, 50); state.shown = PAGE; writeUrl(); applyFilters(); renderList(); }, 200);
    });
    $("district").addEventListener("change", (e) => {
      state.gu = Object.hasOwn(DISTRICT_EN, e.target.value) ? e.target.value : ""; update();
    });
    $("sort").addEventListener("change", (e) => { state.sort = SORTS.includes(e.target.value) ? e.target.value : "ending"; update(); });
    $("free").addEventListener("change", (e) => { state.free = e.target.checked; update(); });
    $("more").addEventListener("click", () => { state.shown += PAGE; renderList(); });
    $("reset").addEventListener("click", () => {
      Object.assign(state, { when: "week", cat: "all", gu: "", free: false, q: "", sort: "ending" }); update();
    });
    $("lang-toggle").addEventListener("click", () => { state.lang = state.lang === "en" ? "ko" : "en"; update(); });
    const dlg = $("detail");
    $("d-close").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // 바깥 클릭 시 닫기
  }

  // ---------- 시작 ----------
  function isValidEvent(e) {
    return e && typeof e.title === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.start) && /^\d{4}-\d{2}-\d{2}$/.test(e.end);
  }

  async function init() {
    readUrl();
    bind();
    try {
      const res = await fetch("data/events.json", { cache: "no-cache", credentials: "omit" });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      data = { ...json, events: Array.isArray(json.events) ? json.events.filter(isValidEvent) : [] };
      update();
    } catch {
      renderStatic();
      $("empty").textContent = t("loadError");
      $("empty").hidden = false;
    }
  }

  init();
})();
