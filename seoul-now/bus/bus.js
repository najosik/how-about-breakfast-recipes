// 외국인 관광객 버스 이용 추정 대시보드
// 보안: 데이터는 textContent로만 출력(innerHTML 미사용), URL 파라미터는 허용 목록으로 검증.
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const TOP_N = 20;

  const T = {
    ko: {
      title: "외국인 관광객이 많이 타는 서울 버스 (추정)",
      sub: "정류장 승하차 × 행정동 단기체류 외국인 비율로 추정한 노선별 순위",
      langToggle: "English",
      back: "← Seoul Now",
      estimate: "이 수치는 실제 외국인 탑승객 수가 아닌 추정치입니다. 아래 ‘방법과 한계’를 꼭 함께 확인하세요.",
      loading: "분석 결과를 불러오는 중입니다…",
      noData: "아직 분석 결과가 없습니다. 첫 분석이 끝나면 이 페이지에 표시됩니다.",
      loadError: "분석 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      kMonth: "분석 기준월", kRoutes: "분석 노선", kMatch: "정류장 위치 매칭률", kCity: "서울 버스 평균 외국인 비중",
      kRoutesSub: (n) => `정류장 ${n.toLocaleString("ko")}곳`, kCitySub: "모든 노선 승하차 가중 평균",
      rankH: "노선 순위", mExp: "외국인 추정 이용량", mIndex: "외국인 비중",
      typeAll: "전체 유형", qPh: "노선 번호 검색", lblType: "노선 유형", lblQ: "노선 검색",
      descExp: "한 달 동안 외국인으로 추정되는 승하차 건수가 많은 노선입니다. 이용량이 큰 간선버스가 상위에 오기 쉽습니다.",
      descIndex: (n) => `노선 전체 승하차 중 외국인으로 추정되는 비율이 높은 노선입니다. 월 승하차 ${n.toLocaleString("ko")}건 이상인 노선만 포함합니다.`,
      noMatch: "조건에 맞는 노선이 없습니다.",
      dUse: "월 승하차", dExp: "외국인 추정 승하차", dIndex: "외국인 비중", dChina: "그중 중국인 비중",
      lift: (x) => `서울 평균의 ${x.toFixed(1)}배`,
      hourH: "시간대별 외국인 추정 승하차", hourNote: "막대에 마우스를 올리면(모바일은 탭) 전체 승하차와 비중을 볼 수 있습니다.",
      stopsH: "외국인 추정 이용이 많은 정류장",
      thStop: "정류장", thArs: "정류장 번호", thDong: "행정동", thUse: "승하차", thExp: "외국인 추정", thShare: "비중",
      tipHour: (h) => `${h}시`, tipExp: "외국인 추정", tipUse: "전체 승하차", tipShare: "비중",
      dongH: "낮 시간 외국인 비율이 높은 행정동",
      dongDesc: "10~18시 생활인구 중 단기체류 외국인 비율(일평균). 버스 정류장이 있는 행정동만 표시합니다.",
      thRank: "순위", thDongName: "행정동", thDongShare: "외국인 비율", thDongPop: "외국인 생활인구(시간당 평균)",
      methodH: "방법과 한계",
      method: [
        "각 정류장의 시간대별 승하차 인원에, 그 정류장이 속한 행정동의 같은 시간대 ‘단기체류 외국인 비율’(단기체류 외국인 ÷ (내국인 + 단기체류 외국인) 생활인구, 월 일평균)을 곱해 노선별로 합산했습니다.",
        "‘외국인 추정 이용량’은 그 합계이고, ‘외국인 비중’은 이를 노선 전체 승하차로 나눈 값입니다. 정류장 좌표는 행정동 경계와 대조해 행정동을 판정했습니다.",
      ],
      limitsH: "한계",
      limits: [
        "국적 정보가 없는 승하차 데이터를 지역 비율로 나눈 추정치이며, 실제 외국인 탑승객 수가 아닙니다.",
        "버스는 지하철보다 외국인 이용 비중이 낮고, 일반 교통카드를 쓰는 외국인이 많아 실제보다 적거나 다르게 잡힐 수 있습니다.",
        "생활인구는 KT 통신 데이터 기반 추정값입니다. 로밍을 쓰지 않거나 현지 유심을 쓰는 관광객은 빠지거나 다르게 분류될 수 있습니다.",
        "같은 행정동 안의 모든 정류장에 같은 비율을 적용하므로, 넓은 행정동이나 경계 부근 정류장은 오차가 큽니다.",
        "심야에는 도심 내국인 생활인구가 크게 줄어 외국인 비율이 높게 나옵니다. 심야버스의 비중 지수는 과대 추정일 수 있습니다.",
        "서울 밖(경기도 등) 정류장은 서울 행정동 경계에 포함되지 않아 외국인 추정에서 빠집니다.",
        "장기체류 외국인은 비율 계산에서 제외했습니다. 버스 데이터와 생활인구 데이터는 같은 월 기준입니다.",
      ],
      updated: (m, d) => `기준월 ${m} · 분석 ${d}`,
      mapH: "지도로 보기",
      mapDesc: "행정동 색은 낮 시간 외국인 비율, 주황 원은 외국인 추정 이용이 많은 정류장(크기 = 이용량), 빨간 선은 선택한 노선입니다. 노선도는 정류장을 순서대로 이은 선이며 실제 운행 도로와 다를 수 있습니다.",
      layerDong: "행정동 외국인 비율", layerHot: "주요 정류장", layerRoute: "선택 노선",
      legendDong: "낮 시간 외국인 비율", legendHot: "외국인 추정 이용", legendRoute: "선택 노선",
      noShare: "자료 없음",
      mapPrivacy: "배경 지도는 OpenStreetMap 서버에서 불러오며, 이때 접속 IP 등 기술 정보가 OpenStreetMap에 전달됩니다. 이 페이지는 쿠키나 분석 도구를 쓰지 않습니다.",
      mapAria: "서울 버스 외국인 이용 추정 지도",
      routeNoMap: "이 노선은 서울 정류장 좌표가 부족해 지도에 노선을 그리지 못했습니다.",
      tipRoutes: "경유 노선", tipSeq: (n) => `${n}번째 정류장`,
      hotH: "외국인 추정 이용이 많은 정류장 (서울 전체)",
      hotDesc: "여러 노선의 승하차를 정류장별로 합산했습니다. 상위 20곳을 표시하며, 지도에는 상위 300곳이 표시됩니다.",
      thRoutes: "경유 노선",
    },
    en: {
      title: "Seoul Bus Routes Popular with Visitors (Estimate)",
      sub: "Routes ranked by stop boardings × share of short-stay foreigners in each stop's neighborhood",
      langToggle: "한국어",
      back: "← Seoul Now",
      estimate: "These figures are estimates, not counts of foreign passengers. Please read “Method & limits” below.",
      loading: "Loading analysis…",
      noData: "No analysis yet. Results will appear here after the first run.",
      loadError: "Could not load the analysis. Please try again later.",
      kMonth: "Month analyzed", kRoutes: "Routes analyzed", kMatch: "Stop location match rate", kCity: "Seoul bus average foreign share",
      kRoutesSub: (n) => `${n.toLocaleString("en")} stops`, kCitySub: "ridership-weighted, all routes",
      rankH: "Route ranking", mExp: "Est. foreign trips", mIndex: "Foreign share",
      typeAll: "All types", qPh: "Search route no.", lblType: "Route type", lblQ: "Search route",
      descExp: "Routes with the most boardings and alightings estimated to be by foreign visitors in a month. High-volume trunk routes tend to rank high.",
      descIndex: (n) => `Routes with the highest estimated foreign share of all trips. Only routes with at least ${n.toLocaleString("en")} trips a month.`,
      noMatch: "No routes match.",
      dUse: "Monthly trips", dExp: "Est. foreign trips", dIndex: "Foreign share", dChina: "of which Chinese",
      lift: (x) => `${x.toFixed(1)}× Seoul average`,
      hourH: "Estimated foreign trips by hour", hourNote: "Hover (or tap) a bar to see total trips and share.",
      stopsH: "Stops with the most estimated foreign trips",
      thStop: "Stop", thArs: "Stop no.", thDong: "Neighborhood", thUse: "Trips", thExp: "Est. foreign", thShare: "Share",
      tipHour: (h) => `${h}:00`, tipExp: "Est. foreign", tipUse: "All trips", tipShare: "Share",
      dongH: "Neighborhoods with the highest daytime foreign share",
      dongDesc: "Short-stay foreigners as a share of the 10:00–18:00 living population (daily average). Only neighborhoods with bus stops.",
      thRank: "#", thDongName: "Neighborhood", thDongShare: "Foreign share", thDongPop: "Foreign population (avg per hour)",
      methodH: "Method & limits",
      method: [
        "For each stop and hour, boardings + alightings are multiplied by the short-stay foreigner share of the stop's administrative neighborhood (dong) at that hour — short-stay foreigners ÷ (residents + short-stay foreigners) in the living-population data, daily average for the month — and summed per route.",
        "“Est. foreign trips” is that sum; “Foreign share” divides it by the route's total trips. Stops are assigned to neighborhoods by matching their coordinates against boundary polygons.",
      ],
      limitsH: "Limits",
      limits: [
        "Ridership data has no nationality, so these are area-based estimates, not counts of foreign passengers.",
        "Foreign visitors ride buses less than the subway, and many use ordinary transit cards, so usage may be under- or mis-estimated.",
        "Living population is estimated from KT mobile data; visitors without roaming or with local SIMs may be missed or classified differently.",
        "Every stop in a neighborhood gets the same share, so large neighborhoods and stops near boundaries carry more error.",
        "At night the resident population in central Seoul drops sharply, inflating the foreign share; night-bus (N) shares may be overestimated.",
        "Stops outside Seoul (e.g., Gyeonggi-do) fall outside Seoul's neighborhood boundaries and are not counted in the estimate.",
        "Long-term foreign residents are excluded. Bus and population data refer to the same month.",
      ],
      updated: (m, d) => `Month ${m} · analyzed ${d}`,
      mapH: "Map",
      mapDesc: "Neighborhood shading = daytime foreign share; orange circles = stops with the most estimated foreign trips (size = volume); red line = selected route. Route lines connect stops in order and may not follow actual roads.",
      layerDong: "Foreign share by neighborhood", layerHot: "Top stops", layerRoute: "Selected route",
      legendDong: "Daytime foreign share", legendHot: "Est. foreign trips", legendRoute: "Selected route",
      noShare: "No data",
      mapPrivacy: "Map tiles are loaded from OpenStreetMap servers, which receive technical data such as your IP address. This page uses no cookies or analytics.",
      mapAria: "Map of estimated foreign bus use in Seoul",
      routeNoMap: "Not enough Seoul stop coordinates to draw this route.",
      tipRoutes: "Routes", tipSeq: (n) => `Stop #${n}`,
      hotH: "Stops with the most estimated foreign trips (all of Seoul)",
      hotDesc: "Trips summed across routes per stop. Top 20 shown here; the map shows the top 300.",
      thRoutes: "Routes",
    },
  };

  const state = { lang: "ko", metric: "exp", type: "", q: "", route: "" };
  let data = null;

  const t = (k, ...a) => { const v = T[state.lang][k]; return typeof v === "function" ? v(...a) : v; };
  const loc = () => (state.lang === "ko" ? "ko-KR" : "en-US");
  const fmt = (n, d = 0) => Number(n || 0).toLocaleString(loc(), { maximumFractionDigits: d, minimumFractionDigits: d });
  const pct = (x, d = 1) => `${fmt((x || 0) * 100, d)}%`;
  const fmtMonth = (ym) => (/^\d{6}$/.test(ym) ? (state.lang === "ko" ? `${ym.slice(0, 4)}년 ${+ym.slice(4)}월` : `${ym.slice(0, 4)}-${ym.slice(4)}`) : "");

  function el(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "style") n.style.cssText = v; // CSSOM: CSP(style-src 'self')에서도 허용
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) if (c != null) n.append(c);
    return n;
  }

  function kpi(label, value, sub) {
    return el("div", { class: "kpi" }, el("p", { class: "k-label", text: label }),
      el("p", { class: "k-value", text: value }), sub ? el("p", { class: "k-sub", text: sub }) : null);
  }

  // ---------- 툴팁 ----------
  const tip = $("tooltip");
  function showTip(lines, x, y) {
    tip.replaceChildren(...lines.map((l, i) => el(i ? "div" : "strong", { text: l })));
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(x + 12, innerWidth - r.width - 8)}px`;
    tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------- URL 상태 ----------
  function readUrl() {
    const p = new URLSearchParams(location.search);
    const lang = p.get("lang");
    state.lang = lang === "en" || lang === "ko" ? lang : ((navigator.language || "").toLowerCase().startsWith("ko") ? "ko" : "en");
    if (p.get("metric") === "index") state.metric = "index";
    state.route = (p.get("route") || "").slice(0, 20);
  }
  function writeUrl() {
    const p = new URLSearchParams({ lang: state.lang });
    if (state.metric !== "exp") p.set("metric", state.metric);
    if (state.route) p.set("route", state.route);
    history.replaceState(null, "", `${location.pathname}?${p}`);
  }

  // ---------- 렌더링 ----------
  function renderStatic() {
    document.documentElement.lang = state.lang;
    document.title = `${t("title")} · Seoul Now`;
    $("title").textContent = t("title");
    $("sub").textContent = t("sub");
    $("back").textContent = t("back");
    $("back").setAttribute("href", `../?lang=${state.lang}`);
    $("lang-toggle").textContent = t("langToggle");
    $("estimate-note").textContent = t("estimate");
    $("rank-h").textContent = t("rankH");
    $("lbl-type").textContent = t("lblType");
    $("lbl-q").textContent = t("lblQ");
    $("q").placeholder = t("qPh");
    $("dong-h").textContent = t("dongH");
    $("dong-desc").textContent = t("dongDesc");
    $("map-h").textContent = t("mapH");
    $("map-desc").textContent = t("mapDesc");
    $("map-privacy").textContent = t("mapPrivacy");
    $("map").setAttribute("aria-label", t("mapAria"));
    $("hot-h").textContent = t("hotH");
    $("hot-desc").textContent = t("hotDesc");
    renderLayerToggles();
    renderLegend();
    $("method-h").textContent = t("methodH");
    $("method").replaceChildren(...t("method").map((s) => el("p", { text: s })));
    $("limits-h").textContent = t("limitsH");
    $("limits").replaceChildren(...t("limits").map((s) => el("li", { text: s })));
    $("metric-chips").replaceChildren(...["exp", "index"].map((m) =>
      el("button", { type: "button", class: "chip" + (state.metric === m ? " active" : ""), "aria-pressed": String(state.metric === m),
        text: t(m === "exp" ? "mExp" : "mIndex"), onclick: () => { state.metric = m; writeUrl(); renderRanking(); renderStatic(); } })));
  }

  function renderSummary() {
    const s = data.stats || {};
    $("kpis").replaceChildren(
      kpi(t("kMonth"), fmtMonth(data.month)),
      kpi(t("kRoutes"), fmt(s.routes), t("kRoutesSub", s.stops || 0)),
      kpi(t("kMatch"), pct(s.matchRate)),
      kpi(t("kCity"), pct(data.cityIndex, 2), t("kCitySub")));
    const types = [...new Set(data.routes.map((r) => r.type).filter(Boolean))].sort();
    $("type").replaceChildren(el("option", { value: "", text: t("typeAll") }), ...types.map((ty) => el("option", { value: ty, text: ty })));
    $("type").value = types.includes(state.type) ? state.type : "";
    const d = new Date(data.generatedAt);
    $("updated").textContent = t("updated", fmtMonth(data.month), isNaN(d) ? "" : d.toLocaleDateString(loc()));
    $("sources").replaceChildren(...(data.sources || []).map((s) => el("li", { text: s })));
  }

  function filteredRoutes() {
    const q = state.q.trim();
    let rs = data.routes.filter((r) => (!state.type || r.type === state.type) && (!q || r.no.includes(q)));
    if (state.metric === "index") rs = rs.filter((r) => r.eligible).sort((a, b) => b.index - a.index);
    else rs = rs.slice().sort((a, b) => b.exp - a.exp);
    return rs;
  }

  function renderRanking() {
    const rs = filteredRoutes().slice(0, TOP_N);
    $("rank-desc").textContent = state.metric === "exp" ? t("descExp") : t("descIndex", data.minRouteUse || 0);
    const val = (r) => (state.metric === "exp" ? r.exp : r.index);
    const max = Math.max(...rs.map(val), 0) || 1;
    if (!rs.length) { $("ranking").replaceChildren(el("li", { class: "note", text: t("noMatch") })); return; }
    $("ranking").replaceChildren(...rs.map((r, i) => {
      const v = val(r);
      const label = state.metric === "exp" ? fmt(v) : pct(v, 2);
      return el("li", {}, el("button", {
        type: "button", class: "rank-row" + (r.no === state.route ? " active" : ""),
        "aria-label": `${i + 1}. ${r.no} ${label}`, onclick: () => selectRoute(r.no),
      },
      el("span", { class: "r-no", text: String(i + 1) }),
      el("span", { class: "r-name" }, el("b", { text: r.no }), el("span", { text: `${r.type ? r.type + " · " : ""}${r.name}` })),
      el("span", { class: "r-track", "aria-hidden": "true" }, el("span", { class: "r-bar", style: `width:${(v / max) * 100}%` })),
      el("span", { class: "r-val", text: label })));
    }));
  }

  function selectRoute(no) {
    state.route = no;
    writeUrl();
    renderRanking();
    renderDetail();
    showRouteOnMap();
    $("map").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  function renderDetail() {
    const r = data.routes.find((x) => x.no === state.route);
    $("detail").hidden = !r;
    if (!r) return;
    $("d-title").textContent = `${r.no}${state.lang === "ko" ? "번" : ""}`;
    $("d-name").textContent = `${r.type ? r.type + " · " : ""}${r.name}`;
    $("d-kpis").replaceChildren(
      kpi(t("dUse"), fmt(r.use)),
      kpi(t("dExp"), fmt(r.exp)),
      kpi(t("dIndex"), pct(r.index, 2), r.lift ? t("lift", r.lift) : ""),
      kpi(t("dChina"), pct(r.chinaShare)));

    $("d-hour-h").textContent = t("hourH");
    $("d-hour-note").textContent = t("hourNote");
    const max = Math.max(...r.hourExp, 0) || 1;
    const chart = $("d-chart");
    chart.setAttribute("aria-label", `${t("hourH")}: ${r.hourExp.map((v, h) => `${h}:${Math.round(v)}`).join(", ")}`);
    chart.replaceChildren(...r.hourExp.map((v, h) => {
      const lines = () => [t("tipHour", h), `${t("tipExp")}: ${fmt(v)}`, `${t("tipUse")}: ${fmt(r.hourUse[h])}`,
        `${t("tipShare")}: ${pct(r.hourUse[h] ? v / r.hourUse[h] : 0, 2)}`];
      const col = el("div", {
        class: "hour-col", tabindex: "0",
        onmousemove: (e) => showTip(lines(), e.clientX, e.clientY), onmouseleave: hideTip,
        onfocus: (e) => { const b = e.target.getBoundingClientRect(); showTip(lines(), b.left, b.top); }, onblur: hideTip,
        onclick: (e) => showTip(lines(), e.clientX, e.clientY),
      }, el("div", { class: "h-bar", style: `height:${(v / max) * 100}%` }));
      if (h % 3 === 0) col.append(el("span", { class: "h-tick", text: String(h) }));
      return col;
    }));

    $("d-stops-h").textContent = t("stopsH");
    $("d-stops").replaceChildren(
      el("thead", {}, el("tr", {}, el("th", { text: t("thStop") }), el("th", { text: t("thArs") }), el("th", { text: t("thDong") }),
        el("th", { class: "num", text: t("thUse") }), el("th", { class: "num", text: t("thExp") }), el("th", { class: "num", text: t("thShare") }))),
      el("tbody", {}, ...r.topStops.map((s) => el("tr", {},
        el("td", { text: s.name }), el("td", { text: s.ars }), el("td", { text: s.dong }),
        el("td", { class: "num", text: fmt(s.use) }), el("td", { class: "num", text: fmt(s.exp) }), el("td", { class: "num", text: pct(s.index, 2) })))));
  }

  function renderDongs() {
    $("dongs").replaceChildren(
      el("thead", {}, el("tr", {}, el("th", { class: "num", text: t("thRank") }), el("th", { text: t("thDongName") }),
        el("th", { class: "num", text: t("thDongShare") }), el("th", { class: "num", text: t("thDongPop") }))),
      el("tbody", {}, ...(data.topDongs || []).map((d, i) => el("tr", {},
        el("td", { class: "num", text: String(i + 1) }), el("td", { text: d.name }),
        el("td", { class: "num", text: pct(d.share) }), el("td", { class: "num", text: fmt(d.foreign) })))));
  }

  function renderHot() {
    $("hot").replaceChildren(
      el("thead", {}, el("tr", {}, el("th", { class: "num", text: t("thRank") }), el("th", { text: t("thStop") }),
        el("th", { text: t("thDong") }), el("th", { text: t("thRoutes") }),
        el("th", { class: "num", text: t("thUse") }), el("th", { class: "num", text: t("thExp") }), el("th", { class: "num", text: t("thShare") }))),
      el("tbody", {}, ...(data.hotStops || []).slice(0, 20).map((h, i) => el("tr", {},
        el("td", { class: "num", text: String(i + 1) }), el("td", { text: h.name }), el("td", { text: h.dong }),
        el("td", { text: (h.routes || []).join(", ") }),
        el("td", { class: "num", text: fmt(h.use) }), el("td", { class: "num", text: fmt(h.exp) }), el("td", { class: "num", text: pct(h.index, 2) })))));
  }

  // ---------- 지도 ----------
  // 순차 색상(한 색상, 밝음→어두움). 단계 경계는 외국인 비율.
  const SHARE_BREAKS = [0.01, 0.02, 0.04, 0.08];
  const SHARE_COLORS = ["#eef3fb", "#c6d7ef", "#8fb0de", "#4a7cc2", "#1d4f9a"];
  const HOT_COLOR = "#e8590c";
  const ROUTE_COLOR = "#c8102e";
  const layersOn = { dong: true, hot: true, route: true };
  let map = null, dongLayer = null, hotLayer = null, routeLayer = null, dongGeo = null;
  const routeCache = new Map();

  const shareColor = (v) => (v == null ? null : SHARE_COLORS[SHARE_BREAKS.filter((b) => v >= b).length]);

  function tipEl(title, lines) {
    return el("div", { class: "map-tip" }, el("strong", { text: title }), ...lines.map((l) => el("div", { text: l })));
  }

  function renderLayerToggles() {
    const items = [["dong", "layerDong"], ["hot", "layerHot"], ["route", "layerRoute"]];
    $("layer-toggles").replaceChildren(...items.map(([k, label]) => {
      const cb = el("input", { type: "checkbox" });
      cb.checked = layersOn[k];
      cb.addEventListener("change", () => { layersOn[k] = cb.checked; syncLayers(); });
      return el("label", {}, cb, el("span", { text: t(label) }));
    }));
  }

  function renderLegend() {
    const fmtB = (v) => `${fmt(v * 100, 0)}%`;
    const ranges = [`< ${fmtB(SHARE_BREAKS[0])}`, ...SHARE_BREAKS.slice(0, -1).map((b, i) => `${fmtB(b)}–${fmtB(SHARE_BREAKS[i + 1])}`),
      `≥ ${fmtB(SHARE_BREAKS[SHARE_BREAKS.length - 1])}`];
    const sw = (c) => { const n = el("span", { class: "legend-swatch" }); n.style.background = c; return n; };
    const dot = (d) => { const n = el("span", { class: "legend-dot" }); n.style.cssText = `width:${d}px;height:${d}px;background:${HOT_COLOR}`; return n; };
    const line = el("span", { class: "legend-line" }); line.style.background = ROUTE_COLOR;
    $("map-legend").replaceChildren(
      el("div", { class: "legend-group" }, el("span", { class: "legend-title", text: t("legendDong") }),
        ...ranges.flatMap((r, i) => [sw(SHARE_COLORS[i]), el("span", { text: r })])),
      el("div", { class: "legend-group" }, el("span", { class: "legend-title", text: t("legendHot") }), dot(8), dot(14), dot(22)),
      el("div", { class: "legend-group" }, el("span", { class: "legend-title", text: t("legendRoute") }), line));
  }

  function initMap() {
    if (map || typeof L === "undefined") return;
    map = L.map("map", { center: [37.5665, 126.978], zoom: 12, scrollWheelZoom: false, preferCanvas: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, minZoom: 10,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.createPane("hotPane").style.zIndex = 450;
    map.createPane("routePane").style.zIndex = 460;
    // 페이지 스크롤과 충돌하지 않도록 지도를 클릭한 뒤에만 휠 확대
    map.on("click", () => map.scrollWheelZoom.enable());
    map.on("mouseout", () => map.scrollWheelZoom.disable());
  }

  async function loadDongs() {
    if (dongGeo) return;
    try {
      const res = await fetch("data/dongs.geojson", { cache: "no-cache", credentials: "omit" });
      if (!res.ok) return;
      const gj = await res.json();
      if (gj && gj.type === "FeatureCollection" && Array.isArray(gj.features)) dongGeo = gj;
    } catch { /* 지도 경계 없이도 나머지는 동작 */ }
  }

  function buildDongLayer() {
    if (!map || !dongGeo) return;
    if (dongLayer) dongLayer.remove();
    dongLayer = L.geoJSON(dongGeo, {
      style: (f) => {
        const c = shareColor(f.properties.share);
        return { color: "#ffffff", weight: 0.6, fillColor: c || "#000", fillOpacity: c ? 0.6 : 0 };
      },
      onEachFeature: (f, layer) => {
        const p = f.properties;
        layer.bindTooltip(() => tipEl(String(p.name || ""), [
          `${t("legendDong")}: ${p.share == null ? t("noShare") : pct(p.share)}`]), { sticky: true });
      },
    });
  }

  function buildHotLayer() {
    if (!map || !data) return;
    if (hotLayer) hotLayer.remove();
    const hs = (data.hotStops || []).filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng));
    const max = Math.max(...hs.map((h) => h.exp), 1);
    hotLayer = L.layerGroup(hs.map((h) => L.circleMarker([h.lat, h.lng], {
      pane: "hotPane", radius: 3 + 11 * Math.sqrt(h.exp / max),
      color: "#ffffff", weight: 1.5, fillColor: HOT_COLOR, fillOpacity: 0.8,
    }).bindTooltip(() => tipEl(h.name, [h.dong, `${t("tipExp")}: ${fmt(h.exp)}`, `${t("tipUse")}: ${fmt(h.use)}`,
      `${t("tipShare")}: ${pct(h.index, 2)}`, `${t("tipRoutes")}: ${(h.routes || []).join(", ")}`]))));
  }

  async function showRouteOnMap() {
    if (!map) return;
    if (routeLayer) { routeLayer.remove(); routeLayer = null; }
    const r = data && data.routes.find((x) => x.no === state.route);
    if (!r || !/^[0-9a-f]{12}$/.test(r.id || "")) return;
    let rd = routeCache.get(r.id);
    if (!rd) {
      try {
        const res = await fetch(`data/routes/${r.id}.json`, { cache: "no-cache", credentials: "omit" });
        if (!res.ok) return;
        rd = await res.json();
        if (!rd || !Array.isArray(rd.stops)) return;
        routeCache.set(r.id, rd);
      } catch { return; }
    }
    if (state.route !== r.no) return;   // 그사이 다른 노선을 선택한 경우
    const pts = rd.stops.filter((s) => Number.isFinite(s[2]) && Number.isFinite(s[3]));
    if (pts.length < 2) { $("map-desc").textContent = `${t("mapDesc")} ${t("routeNoMap")}`; return; }
    $("map-desc").textContent = t("mapDesc");
    // 좌표 없는(서울 밖) 정류장에서 선을 끊어 직선이 엉뚱하게 이어지지 않게 함
    const segs = []; let cur = [];
    for (const s of rd.stops) {
      if (Number.isFinite(s[2]) && Number.isFinite(s[3])) cur.push([s[2], s[3]]);
      else if (cur.length) { segs.push(cur); cur = []; }
    }
    if (cur.length) segs.push(cur);
    const maxExp = Math.max(...pts.map((s) => s[5]), 1);
    routeLayer = L.layerGroup([
      L.polyline(segs, { pane: "routePane", color: ROUTE_COLOR, weight: 4, opacity: 0.85 }),
      ...pts.map((s) => L.circleMarker([s[2], s[3]], {
        pane: "routePane", radius: 3 + 7 * Math.sqrt(s[5] / maxExp),
        color: ROUTE_COLOR, weight: 2, fillColor: "#ffffff", fillOpacity: 1,
      }).bindTooltip(() => tipEl(String(s[1] || ""), [
        s[0] != null ? t("tipSeq", s[0]) : "", `${t("tipExp")}: ${fmt(s[5])}`, `${t("tipUse")}: ${fmt(s[4])}`,
        `${t("tipShare")}: ${pct(s[4] ? s[5] / s[4] : 0, 2)}`].filter(Boolean)))),
    ]);
    syncLayers();
    map.fitBounds(L.latLngBounds(pts.map((s) => [s[2], s[3]])), { padding: [24, 24], maxZoom: 15 });
  }

  function syncLayers() {
    if (!map) return;
    for (const [k, layer] of [["dong", dongLayer], ["hot", hotLayer], ["route", routeLayer]]) {
      if (!layer) continue;
      if (layersOn[k] && !map.hasLayer(layer)) layer.addTo(map);
      if (!layersOn[k] && map.hasLayer(layer)) layer.remove();
    }
  }

  async function setupMap() {
    initMap();
    if (!map) return;
    await loadDongs();
    buildDongLayer();
    buildHotLayer();
    syncLayers();
    await showRouteOnMap();
  }

  function renderAll() {
    renderStatic();
    if (!data) return;
    renderSummary();
    renderRanking();
    renderDetail();
    renderHot();
    renderDongs();
    if (map) { buildDongLayer(); buildHotLayer(); syncLayers(); showRouteOnMap(); }  // 언어 전환 시 툴팁 갱신
  }

  function validData(j) {
    return j && /^\d{6}$/.test(j.month) && Array.isArray(j.routes) &&
      j.routes.every((r) => typeof r.no === "string" && Array.isArray(r.hourExp) && r.hourExp.length === 24 && Array.isArray(r.topStops));
  }

  async function init() {
    readUrl();
    $("lang-toggle").addEventListener("click", () => { state.lang = state.lang === "ko" ? "en" : "ko"; writeUrl(); renderAll(); });
    $("type").addEventListener("change", (e) => { state.type = e.target.value; renderRanking(); });
    let timer;
    $("q").addEventListener("input", (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value.slice(0, 20); renderRanking(); }, 150); });
    addEventListener("scroll", hideTip, { passive: true });
    renderStatic();
    $("status").textContent = t("loading");
    $("status").hidden = false;
    try {
      const res = await fetch("data/bus-foreigner.json", { cache: "no-cache", credentials: "omit" });
      if (res.status === 404) { $("status").textContent = t("noData"); return; }
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      if (!validData(j)) throw new Error("invalid");
      data = j;
      if (state.route && !data.routes.some((r) => r.no === state.route)) state.route = "";
      if (!state.route && data.routes.length) state.route = data.routes[0].no;
      $("status").hidden = true;
      renderAll();
      setupMap();
    } catch {
      $("status").textContent = t("loadError");
    }
  }

  init();
})();
