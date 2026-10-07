// Seoul Now — 메인 로직
// 보안: 외부 데이터는 textContent로만 출력(innerHTML 미사용), URL은 http/https만 허용.
"use strict";

(() => {
  const PAGE = 24;
  const WHEN = ["today", "weekend", "week", "month", "all"];
  const SORTS = ["ending", "starting"];
  const $ = (id) => document.getElementById(id);

  const state = {
    lang: "en", when: "week", cat: "all", gu: "", free: false, stage: "s1", q: "", sort: "ending",
    shown: PAGE,
  };
  let data = { events: [] };
  let fit = null;
  let sel = null;          // 1차 선별 결과 { select, rulesVersion, passed }
  let resources = [];      // 관광자원(상시형, 수동 등록)
  let snap = null;         // 보고용 기준일 스냅샷 { date, label, events_at } — ?snapshot=날짜
  const STAGES = ["all", "s1", "s2"];
  const base = () => (snap ? `data/snapshots/${snap.date}/` : "data/");
  let fitHiddenCount = 0;   // { tags, overrides, rulesVersion, updatedAt } — 없으면 패널 숨김
  let filtered = [];

  // ---------- 유틸 ----------
  const t = (k, ...a) => {
    const v = I18N[state.lang][k];
    return typeof v === "function" ? v(...a) : v;
  };

  /** 한국 시간(Asia/Seoul) 기준 오늘 날짜 'YYYY-MM-DD' */
  function kstToday() {
    if (snap && /^\d{4}-\d{2}-\d{2}/.test(snap.events_at)) return snap.events_at.slice(0, 10);   // 스냅샷: 기준일을 오늘로
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
    else state.lang = "ko";   // 기본 한국어(원문 언어). 다른 언어는 상단 번역 버튼(구글 번역)으로
    if (WHEN.includes(p.get("when"))) state.when = p.get("when");
    const cat = p.get("cat");
    if (cat && CATEGORY_GROUPS.some((g) => g.id === cat)) state.cat = cat;
    const gu = p.get("gu");
    if (gu && Object.hasOwn(DISTRICT_EN, gu)) state.gu = gu;
    state.free = p.get("free") === "1";
    const st = p.get("stage");
    state.stage = STAGES.includes(st) ? st : p.get("fit") === "1" ? "s2" : "s1";   // fit=1: 예전 주소 호환
    const sp = p.get("snapshot");
    state.snapshot = sp && /^\d{4}-\d{2}-\d{2}$/.test(sp) ? sp : "";
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
    if (state.stage !== "s1") p.set("stage", state.stage);
    if (snap) p.set("snapshot", snap.date);
    if (state.sort !== "ending") p.set("sort", state.sort);
    if (state.q) p.set("q", state.q);
    history.replaceState(null, "", `${location.pathname}?${p}`);
  }

  // ---------- 필터 ----------
  function applyFilters() {
    const today = kstToday();
    const [from, to] = range(state.when, today);
    const q = state.q.trim().toLowerCase();
    fitHiddenCount = 0;
    const sets = fit ? fitSets() : null;
    if (state.cat === "resource") { filtered = []; return; }   // 관광자원 탭은 별도 목록
    filtered = data.events.filter((ev) => {
      if (!stagePass(ev, state.stage, sets)) { if (state.stage === "s2" && stagePass(ev, "s1", sets)) fitHiddenCount++; return false; }
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
    $("cal-link").textContent = t("calLink", Number(kstToday().slice(0, 4)) + 1);
    $("cal-link").href = `calendar/?lang=${state.lang}${snap ? `&snapshot=${snap.date}` : ""}`;
    $("lbl-when").textContent = t("when");
    $("lbl-type").textContent = t("type");
    $("lbl-search").textContent = t("search");
    $("lbl-district").textContent = t("district");
    $("lbl-sort").textContent = t("sort");
    $("lbl-free").textContent = t("freeOnly");
    $("lbl-fit").textContent = FIT_I18N[state.lang].filter;
    $("fitonly").checked = state.stage === "s2";
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
    const note = $("fit-note");
    const SL = STAGE_I18N[state.lang];
    note.textContent = state.stage === "s2" ? FIT_I18N[state.lang].filterNote(fitHiddenCount) : SL.stageNote[state.stage];
    note.hidden = !note.textContent || state.cat === "resource";
    $("export").hidden = state.cat === "resource" || !filtered.length;
    if (state.cat === "resource") {
      $("count").textContent = t("results", resources.length);
      $("list").replaceChildren(...resources.map(resourceCard));
      $("empty").hidden = resources.length > 0;
      $("more").hidden = true;
      return;
    }
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

  // ---------- 외국인 적합도 패널 ----------
  const FIT_ENUMS = {
    language_barrier: ["low", "mid", "high"], nonverbal: [true, false],
    reservation_barrier: ["none", "online", "kr_auth_required"], audience_restricted: [true, false],
    experience_type: ["traditional", "kculture", "food", "light", "performance", "etc"],
  };
  const overrideIds = (list) => new Set((Array.isArray(list) ? list : [])
    .map((x) => (typeof x === "string" ? x : x && x.id)).filter((x) => typeof x === "string"));

  function fitSets() {
    return { pin: overrideIds(fit.overrides.pin), exc: overrideIds(fit.overrides.exclude) };
  }
  /**
   * 적합도 필터에서 숨길 이유(없으면 null). 담당자 제외 > 담당자 추천 > 자동 규칙.
   * 자동 규칙: 참여 대상 제한, 국내 본인인증 예약, 한국어 이해가 필요한 형식(언어 장벽 높음).
   */
  function fitHidden(ev, { pin, exc }) {
    if (exc.has(ev.id)) return "exclude";
    if (pin.has(ev.id)) return null;
    const tg = Object.hasOwn(fit.tags, ev.id) ? fit.tags[ev.id] : null;
    if (!tg || typeof tg !== "object") return null;   // 아직 분류 안 된 행사는 숨기지 않음
    if (tg.audience_restricted === true) return "restricted";
    if (tg.reservation_barrier === "kr_auth_required") return "kr_auth";
    if (tg.language_barrier === "high") return "language";
    return null;
  }

  /** 단계 통과 여부. s1: 1차 선별 결과(데이터가 없으면 통과로 둠), s2: 1차 통과 + 외국인 적합 */
  function stagePass(ev, stage, sets) {
    if (stage === "all") return true;
    const s1 = !sel || !Object.hasOwn(sel.select, ev.id) ? !sel : sel.select[ev.id].pass === true;
    if (stage === "s1" || !s1) return s1;
    if (!fit || !sets) return false;
    if (sets.exc.has(ev.id)) return false;
    if (sets.pin.has(ev.id)) return true;
    const tg = Object.hasOwn(fit.tags, ev.id) ? fit.tags[ev.id] : null;
    return !!tg && tg.language_barrier === "low" && tg.audience_restricted !== true && tg.reservation_barrier !== "kr_auth_required";
  }
  function stageCounts() {
    const sets = fit ? fitSets() : null;
    const c = { all: data.events.length, s1: 0, s2: 0 };
    for (const ev of data.events) { if (stagePass(ev, "s1", sets)) c.s1++; if (stagePass(ev, "s2", sets)) c.s2++; }
    return c;
  }

  function fitSummary() {
    const sets0 = fitSets();
    const ids = new Set(data.events.filter((e) => stagePass(e, "s1", sets0)).map((e) => e.id));
    const tags = Object.entries(fit.tags).filter(([id, v]) => ids.has(id) && v && typeof v === "object").map(([, v]) => v);
    const pin = overrideIds(fit.overrides.pin), exc = overrideIds(fit.overrides.exclude);
    const counts = {};
    for (const k of Object.keys(FIT_ENUMS)) {
      counts[k] = new Map(FIT_ENUMS[k].map((v) => [v, 0]));
      for (const tg of tags) if (counts[k].has(tg[k])) counts[k].set(tg[k], counts[k].get(tg[k]) + 1);
    }
    let excluded = 0;
    for (const [id, tg] of Object.entries(fit.tags)) {
      if (!ids.has(id) || !tg) continue;
      if (exc.has(id) || (!pin.has(id) && (tg.audience_restricted === true || tg.reservation_barrier === "kr_auth_required"))) excluded++;
    }
    return { total: tags.length, counts, excluded, pinned: [...pin].filter((id) => ids.has(id) && !exc.has(id)).length };
  }

  function renderFit() {
    const box = $("fit");
    if (!fit || !data.events.length) { box.hidden = true; return; }
    const L = FIT_I18N[state.lang];
    const sum = fitSummary();
    if (!sum.total) { box.hidden = true; return; }
    const pct = (n) => (sum.total ? Math.round((n / sum.total) * 100) : 0);
    $("fit-title").textContent = L.title;
    $("fit-lead").textContent = L.lead(sum.total);
    const stat = (n, label, cls) => el("li", { class: "fit-stat " + cls },
      el("strong", { text: n.toLocaleString(state.lang) }), el("span", { text: label }));
    $("fit-stats").replaceChildren(
      stat(stageCounts().s2, STAGE_I18N[state.lang].steps.s2, "good"),
      stat(sum.counts.reservation_barrier.get("online"), L.statBooking, "warn"),
      stat(sum.excluded, L.statExcluded, "bad"),
      ...(sum.pinned ? [stat(sum.pinned, L.statPinned, "good")] : []));
    $("fit-toggle").textContent = L.toggle;
    $("fit-rules").replaceChildren(...L.rules.map((r) => el("div", { class: "fit-rule" },
      el("h3", { text: r.name }),
      el("p", { class: "fit-how", text: r.how }),
      el("ul", { class: "fit-bars" }, ...[...sum.counts[r.key]].map(([v, n]) => {
        const bar = el("span", { class: "fit-bar" });
        bar.style.width = pct(n) + "%";   // CSSOM 사용(인라인 style 속성은 CSP로 막힘)
        return el("li", {}, el("span", { class: "fit-val", text: r.values[String(v)] }),
          el("span", { class: "fit-track" }, bar),
          el("span", { class: "fit-num", text: `${n.toLocaleString(state.lang)} (${pct(n)}%)` }));
      })))));
    $("fit-foot").textContent = L.foot(fit.rulesVersion,
      /^\d{4}-\d{2}-\d{2}/.test(fit.updatedAt) ? fmtDate(fit.updatedAt.slice(0, 10)) : "-");
    box.hidden = false;
  }

  function renderStages() {
    const box = $("stages");
    if (!data.events.length) { box.hidden = true; return; }
    const SL = STAGE_I18N[state.lang];
    const c = stageCounts();
    $("stages-title").textContent = SL.title;
    const when = snap ? snap.events_at : data.updatedAt;
    const d = new Date(when);
    const stamp = isNaN(d) ? "-" : d.toLocaleString(state.lang === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }) + " KST";
    $("basis").textContent = snap ? SL.basisSnap(stamp, snap.label) : SL.basisLive(stamp);
    $("basis").classList.toggle("snap", !!snap);
    $("stage-steps").replaceChildren(...STAGES.map((k, i) => el("li", {},
      el("button", { type: "button", class: "stage-btn" + (state.stage === k ? " active" : ""), "aria-pressed": String(state.stage === k),
        onclick: () => { state.stage = k; if (state.cat === "resource") state.cat = "all"; update(); } },
        el("span", { class: "stage-name", text: SL.steps[k] }), el("strong", { class: "stage-num", text: c[k].toLocaleString(state.lang) })),
      i < STAGES.length - 1 ? el("span", { class: "stage-arrow", "aria-hidden": "true", text: "→" }) : null)));
    $("s1-toggle").textContent = SL.s1Toggle;
    $("s1-lead").textContent = sel ? SL.s1Lead(c.all, c.s1) + " " + SL.hint : SL.hint;
    // 세부 기준별 건수(수집 전체 기준)
    const tally = new Map();
    let pinned = 0;
    if (sel) for (const ev of data.events) {
      const r = sel.select[ev.id];
      if (!r) continue;
      for (const x of [...(r.tourism_value || []), ...(r.citizen_demand || [])]) {
        const k = String(x).replace(/\(.*\)$/, "");
        tally.set(k, (tally.get(k) || 0) + 1);
      }
      if (r.override === "pin") pinned++;
    }
    $("s1-rules").replaceChildren(...SL.groups.map((g) => el("div", { class: "fit-rule" },
      el("h3", { text: g.name }), el("p", { class: "fit-how", text: g.how }),
      el("ul", { class: "fit-bars" }, ...(g.key === "policy"
        ? [el("li", {}, el("span", { class: "fit-val", text: state.lang === "ko" ? "담당자 고정" : "Staff pins" }), el("span"), el("span", { class: "fit-num", text: String(pinned) }))]
        : [...tally].filter(([k]) => (g.key === "tourism_value") === ["관광 밀집 자치구", "축제 분류", "반복 개최"].includes(k))
          .map(([k, n]) => el("li", {}, el("span", { class: "fit-val", text: k }), el("span"), el("span", { class: "fit-num", text: `${n}` }))))))));
    $("s1-foot").textContent = sel ? SL.s1Foot(sel.rulesVersion) : "";
    $("export").textContent = SL.export;
    box.hidden = false;
  }

  function resourceCard(r) {
    const L = state.lang;
    const SL = STAGE_I18N[L];
    const txt = (o) => (o && typeof o === "object" ? String(o[L] || o.ko || "") : "");
    return el("li", {}, el("div", { class: "card resource" },
      el("div", { class: "card-body" },
        el("p", { class: "meta", text: `${txt(r.kind)} · ${guLabel(r.district || "")}` }),
        el("h2", { class: "title", text: txt(r.name) }),
        el("p", { class: "date", text: `${SL.resSchedule}: ${txt(r.schedule)}` }),
        el("p", { class: "place", text: txt(r.note) }))));
  }

  /** 선별 목록을 schema.org Event(JSON-LD)로 내려받기: 하나의 DB를 외부 플랫폼에 공급하는 시연 */
  function exportJsonLd() {
    const items = filtered.map((ev) => ({
      "@type": "Event", name: ev.title, startDate: ev.start, endDate: ev.end, eventStatus: "https://schema.org/EventScheduled",
      isAccessibleForFree: ev.free === true, ...(safeUrl(ev.link || ev.homepage) ? { url: safeUrl(ev.link || ev.homepage) } : {}),
      location: { "@type": "Place", name: ev.place, address: { "@type": "PostalAddress", addressLocality: ev.district, addressRegion: "서울특별시", addressCountry: "KR" },
        ...(Number.isFinite(ev.lat) && Number.isFinite(ev.lng) ? { geo: { "@type": "GeoCoordinates", latitude: ev.lat, longitude: ev.lng } } : {}) },
      ...(ev.org ? { organizer: { "@type": "Organization", name: ev.org } } : {}),
    }));
    const doc = { "@context": "https://schema.org", "@type": "ItemList", name: `seoul-now ${STAGE_I18N[state.lang].steps[state.stage]}`,
      dateCreated: snap ? snap.events_at : data.updatedAt, numberOfItems: items.length,
      itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, item })) };
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/ld+json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: `seoul-now-${state.stage}-${(snap ? snap.date : kstToday())}.jsonld` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $("export-note").textContent = STAGE_I18N[state.lang].exported(items.length);
  }

  async function loadFit() {
    const get = async (url) => {
      try {
        const res = await fetch(url, { cache: "no-cache", credentials: "omit" });
        return res.ok ? await res.json() : null;
      } catch { return null; }
    };
    const [tags, overrides, select, res] = await Promise.all([get(base() + "festival_tags.json"),
      get(base() + "festival_overrides.json").then((o) => o || get("data/festival_overrides.json")),
      get(base() + "tourism_select.json"), get("data/tourism_resources.json")]);
    if (select && select.select && typeof select.select === "object" && !Array.isArray(select.select)) {
      sel = { select: select.select, rulesVersion: String(select.rules_version || "").slice(0, 40) };
    }
    resources = res && Array.isArray(res.items) ? res.items.slice(0, 50).filter((r) => r && typeof r === "object") : [];
    if (!tags || typeof tags.tags !== "object" || Array.isArray(tags.tags)) return;
    fit = { tags: tags.tags, overrides: overrides && typeof overrides === "object" ? overrides : {},
      rulesVersion: String(tags.rules_version || "").slice(0, 20), updatedAt: String(tags.updatedAt || "").slice(0, 25) };
    $("fit-filter").hidden = false;   // 태그를 읽은 뒤에만 필터를 보여 준다
    update();
  }

  function update() {
    state.shown = PAGE;
    writeUrl();
    renderStatic();
    renderStages();
    renderFit();
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
    $("fitonly").addEventListener("change", (e) => { state.stage = e.target.checked ? "s2" : "s1"; update(); });
    $("export").addEventListener("click", exportJsonLd);
    $("more").addEventListener("click", () => { state.shown += PAGE; renderList(); });
    $("reset").addEventListener("click", () => {
      Object.assign(state, { when: "week", cat: "all", gu: "", free: false, stage: "s1", q: "", sort: "ending" }); update();
    });
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
    if (state.snapshot) {
      try {
        const r = await fetch("data/snapshots/index.json", { cache: "no-cache", credentials: "omit" });
        const idx = r.ok ? await r.json() : null;
        const hit = idx && Array.isArray(idx.snapshots) && idx.snapshots.find((x) => x && x.date === state.snapshot);
        if (hit) snap = { date: hit.date, label: String(hit.label || "").slice(0, 60), events_at: String(hit.events_at || "") };
      } catch { snap = null; }
    }
    try {
      const res = await fetch(base() + "events.json", { cache: "no-cache", credentials: "omit" });
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      data = { ...json, events: Array.isArray(json.events) ? json.events.filter(isValidEvent) : [] };
      update();
      loadFit();   // 패널은 부가 정보: 실패해도 목록에 영향 없음
    } catch {
      renderStatic();
      $("empty").textContent = t("loadError");
      $("empty").hidden = false;
    }
  }

  init();
})();
