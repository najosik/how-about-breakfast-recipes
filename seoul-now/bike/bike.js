// 따릉이 대여소별 외국인·내국인 이용 추정 지도.
// 보안: 데이터는 textContent·DOM 노드로만 출력(innerHTML 미사용), 쿼리 값은 허용 목록 검증. 개인정보 수집 없음.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const METRICS = ["foreign", "local", "share"];
  const SHARE_BREAKS = [0.01, 0.03, 0.06, 0.1];
  const SHARE_COLORS = ["#eef3fb", "#c6d7ef", "#8fb0de", "#4a7cc2", "#1d4f9a"];
  const COLOR = { foreign: "#e8590c", local: "#1d4f9a" };
  const TOP = 30;

  const I18N = {
    ko: {
      title: "따릉이 외국인·내국인 이용 추정 지도", sub: "대여소별 월 대여 건수 × 그 동네 단기체류 외국인 비율",
      lang: "English", note: "추정치입니다. 따릉이는 이용자 국적을 공개하지 않아, 대여소가 있는 행정동의 외국인 비율로 나눠 추정했습니다.",
      loading: "불러오는 중…", error: "데이터를 불러오지 못했어요.",
      kStations: "분석 대여소", kUse: "월 대여 건수", kForeign: "외국인 추정 이용", kShare: "서울 평균 비율", kDay: "일일권 비율",
      mapH: "대여소 지도", dongLayer: "행정동 외국인 비율 색칠",
      metric: { foreign: "외국인 많이", local: "내국인 많이", share: "외국인 비율" },
      mapDesc: {
        foreign: "원 크기 = 외국인 추정 월 대여 건수. 상위 대여소일수록 큽니다.",
        local: "원 크기 = 내국인 추정 월 대여 건수.",
        share: "색 = 대여소가 있는 동의 단기체류 외국인 비율(07~22시). 진할수록 외국인 비율이 높습니다.",
      },
      rankH: { foreign: "외국인 추정 이용 상위 대여소", local: "내국인 추정 이용 상위 대여소", share: "외국인 비율 높은 대여소" },
      rankDesc: (n) => `상위 ${TOP}곳. 이름을 누르면 지도에서 위치를 보여줍니다.` + (n ? ` 비율 순위는 월 대여 ${n}건 이상만.` : ""),
      th: { no: "순위", name: "대여소", dong: "행정동", use: "월 대여", foreign: "외국인 추정", local: "내국인 추정", share: "외국인 비율", day: "일일권" },
      dongH: "외국인 추정 이용이 많은 행정동", dongDesc: "대여소를 행정동별로 합친 값입니다.",
      thDong: { dong: "행정동", stations: "대여소", use: "월 대여", foreign: "외국인 추정", share: "외국인 비율" },
      legendSize: "원 크기: 추정 건수", legendShare: "외국인 비율",
      methodH: "추정 방법",
      method: (d) => [
        `대여소별 ${fmtYm(d.month)} 월 대여 건수(이용권·성별·연령 집계를 대여소별로 합산)에, 대여소가 속한 행정동의 단기체류 외국인 비율을 곱해 외국인 추정 이용으로 봤습니다. 나머지는 내국인 추정 이용입니다.`,
        `외국인 비율 = 단기체류 외국인 생활인구 ÷ (내국인 + 단기체류 외국인 생활인구), ${fmtYm(d.popMonth)} 전체 일 ${d.shareHours[0]}~${d.shareHours[1]}시 평균.`,
        "일일권 비율은 정기권이 아닌 일일권(비회원 포함) 대여의 비중으로, 관광·단기 이용 성격을 보조로 보여줍니다.",
      ],
      limitsH: "한계",
      limits: [
        "실제 외국인 이용 건수가 아닙니다. 동네에 외국인이 많으면 그 동 대여소의 이용도 같은 비율로 외국인이 했다고 가정합니다.",
        "대여(빌린 곳)만 집계합니다. 반납 장소와 시간대별 이용은 반영하지 않습니다.",
        "외국인 비율은 낮·저녁(07~22시) 평균이라 심야 이용 특성은 반영되지 않습니다.",
        "개인 단위 대여 이력은 쓰지 않고, 서울시가 공개한 집계 자료만 사용합니다.",
      ],
      updated: (t) => `업데이트 ${t}`, tipUse: "월 대여", tipForeign: "외국인 추정", tipLocal: "내국인 추정", tipShare: "동 외국인 비율", tipDay: "일일권",
      unit: "건", noData: "아직 분석 결과가 없어요.",
    },
    en: {
      title: "Seoul Bike (Ttareungyi): visitor vs resident use", sub: "Monthly rentals per station × short-stay foreigner share of its neighbourhood",
      lang: "한국어", note: "These are estimates. Seoul does not publish riders' nationality, so rentals are split by the foreigner share of each station's neighbourhood.",
      loading: "Loading…", error: "Couldn't load the data.",
      kStations: "Stations", kUse: "Monthly rentals", kForeign: "Est. foreign rentals", kShare: "Seoul average share", kDay: "Day-pass share",
      mapH: "Station map", dongLayer: "Shade neighbourhoods by foreigner share",
      metric: { foreign: "Most foreign use", local: "Most resident use", share: "Foreigner share" },
      mapDesc: {
        foreign: "Circle size = estimated monthly rentals by foreigners.",
        local: "Circle size = estimated monthly rentals by residents.",
        share: "Colour = short-stay foreigner share of the station's neighbourhood (7am–10pm). Darker = higher.",
      },
      rankH: { foreign: "Top stations by estimated foreign use", local: "Top stations by estimated resident use", share: "Stations with the highest foreigner share" },
      rankDesc: (n) => `Top ${TOP}. Tap a name to locate it on the map.` + (n ? ` Share ranking only includes stations with ${n}+ rentals a month.` : ""),
      th: { no: "#", name: "Station", dong: "Neighbourhood", use: "Rentals", foreign: "Est. foreign", local: "Est. resident", share: "Foreign share", day: "Day pass" },
      dongH: "Neighbourhoods with the most estimated foreign use", dongDesc: "Stations summed by neighbourhood (dong).",
      thDong: { dong: "Neighbourhood", stations: "Stations", use: "Rentals", foreign: "Est. foreign", share: "Foreign share" },
      legendSize: "Circle size: estimated rentals", legendShare: "Foreigner share",
      methodH: "Method",
      method: (d) => [
        `Monthly rentals per station (${fmtYm(d.month)}, summed across pass type, gender and age) are multiplied by the short-stay foreigner share of the station's neighbourhood. The rest is counted as resident use.`,
        `Foreigner share = short-stay foreign living population ÷ (resident + short-stay foreign), ${fmtYm(d.popMonth)}, all days, ${d.shareHours[0]}:00–${d.shareHours[1]}:59 average.`,
        "Day-pass share is the share of rentals on day passes (incl. non-member), a rough hint of visitor-style use.",
      ],
      limitsH: "Limitations",
      limits: [
        "Not actual foreign rider counts: each station is assumed to have the same foreigner share as its neighbourhood.",
        "Only rentals (pick-ups) are counted; returns and hour-by-hour use are not.",
        "The foreigner share is a 7am–10pm average, so late-night patterns are not reflected.",
        "Only aggregated public data is used; no individual trip records.",
      ],
      updated: (t) => `Updated ${t}`, tipUse: "Rentals", tipForeign: "Est. foreign", tipLocal: "Est. resident", tipShare: "Area foreign share", tipDay: "Day pass",
      unit: "", noData: "No analysis yet.",
    },
  };

  const q = new URLSearchParams(location.search);
  const state = {
    lang: q.get("lang") === "en" ? "en" : "ko",
    metric: METRICS.includes(q.get("m")) ? q.get("m") : "foreign",
    dongs: q.get("dongs") === "1",
  };
  let data = null, map = null, stationLayer = null, dongLayer = null, dongGeo = null;
  const markers = new Map();
  const t = (k) => I18N[state.lang][k];
  const nf = (n, d = 0) => Number(n).toLocaleString(state.lang === "ko" ? "ko-KR" : "en-US", { maximumFractionDigits: d });
  const pct = (v) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);
  function fmtYm(ym) { const s = String(ym || ""); return /^\d{6}$/.test(s) ? (state.lang === "ko" ? `${s.slice(0, 4)}년 ${Number(s.slice(4))}월` : `${s.slice(0, 4)}-${s.slice(4)}`) : "-"; }
  const shareColor = (v) => SHARE_COLORS[SHARE_BREAKS.filter((b) => v >= b).length];

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of kids) if (c != null) n.append(c);
    return n;
  }
  function writeUrl() {
    const p = new URLSearchParams();
    if (state.lang === "en") p.set("lang", "en");
    if (state.metric !== "foreign") p.set("m", state.metric);
    if (state.dongs) p.set("dongs", "1");
    history.replaceState(null, "", location.pathname + (p.toString() ? `?${p}` : ""));
  }
  function tipEl(s) {
    return el("div", { class: "map-tip" }, el("strong", { text: s.name }), el("span", { class: "tip-row", text: `${s.gu} · ${s.dong}` }),
      el("span", { class: "tip-row", text: `${t("tipUse")} ${nf(s.use)}${t("unit")}` }),
      el("span", { class: "tip-row", text: `${t("tipForeign")} ${nf(s.foreign)}${t("unit")} · ${t("tipLocal")} ${nf(s.local)}${t("unit")}` }),
      el("span", { class: "tip-row", text: `${t("tipShare")} ${pct(s.share)} · ${t("tipDay")} ${pct(s.dayPass)}` }));
  }

  // ---------- 정적 문구 ----------
  function renderStatic() {
    document.documentElement.lang = state.lang;
    $("title").textContent = t("title");
    $("sub").textContent = t("sub");
    $("lang-toggle").textContent = t("lang");
    $("estimate-note").textContent = t("note");
    $("back").href = `../${state.lang === "en" ? "?lang=en" : ""}`;
    $("map-h").textContent = t("mapH");
    $("dong-toggle-lbl").textContent = t("dongLayer");
    $("dong-toggle").checked = state.dongs;
    $("dong-h").textContent = t("dongH");
    $("dong-desc").textContent = t("dongDesc");
    $("method-h").textContent = t("methodH");
    $("limits-h").textContent = t("limitsH");
    $("limits").replaceChildren(...t("limits").map((x) => el("li", { text: x })));
    document.title = `${t("title")} · Seoul Now`;
  }

  function renderData() {
    const d = data;
    const s = d.stats;
    $("kpis").replaceChildren(
      kpi(t("kStations"), nf(s.stations)), kpi(t("kUse"), nf(s.totalUse), fmtYm(d.month)),
      kpi(t("kForeign"), nf(s.foreign), pct(s.foreign / (s.foreign + s.local))),
      kpi(t("kDay"), pct(d.stations.reduce((a, x) => a + x.dayPass * x.use, 0) / Math.max(1, d.stations.reduce((a, x) => a + x.use, 0)))));
    $("metric-chips").replaceChildren(...METRICS.map((m) => el("button", {
      type: "button", class: "chip" + (state.metric === m ? " active" : ""), "aria-pressed": String(state.metric === m),
      text: t("metric")[m], onclick: () => { state.metric = m; writeUrl(); renderData(); drawStations(); },
    })));
    $("map-desc").textContent = t("mapDesc")[state.metric];
    renderLegend();
    renderRank();
    renderDongs();
    $("method").replaceChildren(...t("method")(d).map((x) => el("p", { text: x })));
    const when = new Date(d.generatedAt);
    $("updated").textContent = t("updated")(isNaN(when) ? "-" : when.toLocaleString(state.lang === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }) + " KST");
    $("sources").replaceChildren(...d.sources.map((x) => el("li", { text: x })));
  }
  function kpi(label, value, sub) {
    return el("div", { class: "kpi" }, el("p", { class: "k-label", text: label }), el("p", { class: "k-value", text: value }), sub ? el("p", { class: "k-sub", text: sub }) : null);
  }

  function ranked() {
    const m = state.metric;
    if (m === "share") return data.stations.filter((x) => x.use >= data.minUse).sort((a, b) => b.share - a.share || b.use - a.use).slice(0, TOP);
    return [...data.stations].sort((a, b) => b[m] - a[m]).slice(0, TOP);
  }
  function renderRank() {
    const th = t("th");
    $("rank-h").textContent = t("rankH")[state.metric];
    $("rank-desc").textContent = t("rankDesc")(state.metric === "share" ? data.minUse : 0);
    const rows = ranked();
    const key = state.metric === "share" ? "use" : state.metric;
    const max = Math.max(1, ...rows.map((r) => r[key]));
    $("rank").replaceChildren(
      el("thead", {}, el("tr", {}, ...[th.no, th.name, th.dong, th.use, th.foreign, th.local, th.share, th.day].map((h, i) => el("th", { class: i >= 3 ? "num" : null, text: h })))),
      el("tbody", {}, ...rows.map((r, i) => el("tr", {},
        el("td", { class: "num", text: String(i + 1) }),
        el("td", { class: "rank-name" }, el("button", { type: "button", class: "link", text: r.name, onclick: () => focusStation(r.no) }),
          el("span", { class: "mini-bar", "aria-hidden": "true" }, el("span", { style: null }))),
        el("td", { text: r.dong }),
        el("td", { class: "num", text: nf(r.use) }),
        el("td", { class: "num", text: nf(r.foreign) }),
        el("td", { class: "num", text: nf(r.local) }),
        el("td", { class: "num", text: pct(r.share) }),
        el("td", { class: "num", text: pct(r.dayPass) })))));
    // 막대 너비는 CSSOM으로(인라인 style 속성 없이: CSP style-src 'self')
    $("rank").querySelectorAll(".mini-bar > span").forEach((b, i) => { b.style.width = `${(rows[i][key] / max) * 100}%`; });
  }
  function renderDongs() {
    const th = t("thDong");
    $("dongs").replaceChildren(
      el("thead", {}, el("tr", {}, ...[th.dong, th.stations, th.use, th.foreign, th.share].map((h, i) => el("th", { class: i ? "num" : null, text: h })))),
      el("tbody", {}, ...data.dongs.slice(0, 20).map((r) => el("tr", {},
        el("td", { text: r.dong }), el("td", { class: "num", text: nf(r.stations) }), el("td", { class: "num", text: nf(r.use) }),
        el("td", { class: "num", text: nf(r.foreign) }), el("td", { class: "num", text: pct(r.share) })))));
  }
  function renderLegend() {
    const items = [];
    if (state.metric === "share" || state.dongs) {
      items.push(el("span", { class: "legend-group" }, el("span", { class: "legend-title", text: t("legendShare") }),
        ...SHARE_COLORS.map((c, i) => {
          const sw = el("span", { class: "legend-swatch" }); sw.style.background = c;
          const lo = i ? SHARE_BREAKS[i - 1] : 0, hi = SHARE_BREAKS[i];
          return el("span", {}, sw, ` ${Math.round(lo * 100)}${hi ? `–${Math.round(hi * 100)}` : "+"}%`);
        })));
    }
    if (state.metric !== "share") {
      const dot = el("span", { class: "legend-dot" }); dot.style.width = dot.style.height = "12px"; dot.style.background = COLOR[state.metric];
      items.push(el("span", { class: "legend-group" }, dot, ` ${t("legendSize")}`));
    }
    $("map-legend").replaceChildren(...items);
  }

  // ---------- 지도 ----------
  function initMap() {
    if (map || typeof L === "undefined") return;
    map = L.map("map", { center: [37.5565, 126.99], zoom: 12, scrollWheelZoom: false, preferCanvas: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, minZoom: 10,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.on("click", () => map.scrollWheelZoom.enable());
    map.on("mouseout", () => map.scrollWheelZoom.disable());
    $("map").setAttribute("aria-label", t("mapH"));
  }
  function drawStations() {
    if (!map) return;
    if (stationLayer) stationLayer.remove();
    markers.clear();
    const m = state.metric;
    const max = Math.max(1, ...data.stations.map((s) => (m === "share" ? 0 : s[m])));
    const list = m === "share" ? data.stations : [...data.stations].sort((a, b) => a[m] - b[m]);   // 큰 원이 위로
    stationLayer = L.layerGroup(list.map((s) => {
      const style = m === "share"
        ? { radius: 4, color: "#ffffff", weight: 0.8, fillColor: shareColor(s.share), fillOpacity: 0.95 }
        : { radius: 2 + 16 * Math.sqrt(s[m] / max), color: "#ffffff", weight: 0.8, fillColor: COLOR[m], fillOpacity: 0.7 };
      const c = L.circleMarker([s.lat, s.lng], style);
      c.bindTooltip(() => tipEl(s), { direction: "top", offset: [0, -6] });
      markers.set(s.no, c);
      return c;
    })).addTo(map);
  }
  async function toggleDongs() {
    if (!map) return;
    if (state.dongs && !dongGeo) {
      try {
        const res = await fetch("../bus/data/dongs.geojson", { cache: "no-cache", credentials: "omit" });
        if (res.ok) dongGeo = await res.json();
      } catch { /* 색칠 없이 계속 */ }
    }
    if (dongLayer) { dongLayer.remove(); dongLayer = null; }
    if (state.dongs && dongGeo) {
      dongLayer = L.geoJSON(dongGeo, {
        style: (f) => ({ color: "#ffffff", weight: 0.5, fillColor: f.properties.share == null ? "#000" : shareColor(f.properties.share), fillOpacity: f.properties.share == null ? 0 : 0.45 }),
        interactive: false,
      }).addTo(map);
      dongLayer.bringToBack();
    }
    renderLegend();
  }
  function focusStation(no) {
    const c = markers.get(no);
    if (!c) return;
    $("map").scrollIntoView({ behavior: "smooth", block: "center" });
    map.setView(c.getLatLng(), 15);
    c.openTooltip();
  }

  function validData(j) {
    return j && /^\d{6}$/.test(String(j.month)) && Array.isArray(j.stations) && Array.isArray(j.dongs) && j.stats
      && j.stations.every((s) => typeof s.no === "string" && typeof s.name === "string" && Number.isFinite(s.lat) && Number.isFinite(s.lng)
        && Number.isFinite(s.use) && Number.isFinite(s.foreign) && Number.isFinite(s.local) && Number.isFinite(s.share));
  }

  async function init() {
    renderStatic();
    const st = $("status");
    st.hidden = false; st.textContent = t("loading");
    try {
      const res = await fetch("data/bike-foreigner.json", { cache: "no-cache", credentials: "omit" });
      if (res.status === 404) { st.textContent = t("noData"); return; }
      if (!res.ok) throw new Error("http");
      const j = await res.json();
      if (!validData(j)) throw new Error("shape");
      data = j;
    } catch {
      st.textContent = t("error");
      return;
    }
    st.hidden = true;
    initMap();
    renderData();
    drawStations();
    toggleDongs();
  }

  $("lang-toggle").addEventListener("click", () => {
    state.lang = state.lang === "ko" ? "en" : "ko";
    writeUrl(); renderStatic();
    if (data) { renderData(); drawStations(); }
  });
  $("dong-toggle").addEventListener("change", (e) => { state.dongs = e.target.checked; writeUrl(); toggleDongs(); });
  init();
})();
