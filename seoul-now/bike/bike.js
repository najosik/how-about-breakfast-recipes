// 따릉이 대여소별 외국인·내국인 이용 추정 지도.
// 보안: 데이터는 textContent·DOM 노드로만 출력(innerHTML 미사용), 쿼리 값은 허용 목록 검증. 개인정보 수집 없음.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const METRICS = ["foreign", "local", "diff", "share"];
  const LQ_BREAKS = [0.5, 0.8, 1.25, 2];   // 외국인 상대 비중(서울 평균 = 1) 구간
  const SHARE_BREAKS = [0.01, 0.03, 0.06, 0.1];
  const SHARE_COLORS = ["#eef3fb", "#c6d7ef", "#8fb0de", "#4a7cc2", "#1d4f9a"];
  // 외국인·내국인 색은 CSS 토큰(--c-for, --c-loc: 라이트·다크 각각 검증)에서 읽는다
  const cssVar = (n, fb) => (getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb);
  const COLOR = {
    get foreign() { return cssVar("--c-for", "#e8590c"); },
    get local() { return cssVar("--c-loc", "#1d4f9a"); },
  };
  const TOP = 30;

  const I18N = {
    ko: {
      title: "따릉이 외국인·내국인 이용 추정 지도", sub: "대여소별 월 대여 × 동네 단기체류 외국인 비율 × 대여소 이용 행태 보정",
      lang: "English", note: "추정치입니다. 따릉이는 이용자 국적을 공개하지 않아 공개 집계 자료로 추정했습니다. 방법은 바로 아래에 있습니다.",
      loading: "불러오는 중…", error: "데이터를 불러오지 못했어요.",
      kStations: "분석 대여소", kUse: "월 대여 건수", kForeign: "외국인 추정 이용", kShare: "서울 평균 비율", kDay: "비회원 추정 이용 비율",
      howH: "이렇게 추정했어요",
      howSteps: (d) => [
        ["대여소별 월 대여 건수", `서울시가 공개한 따릉이 대여소별 ${fmtYm(d.month)} 대여 건수(집계 자료)에서 시작합니다.`],
        ["× 동네 외국인 비율", `대여소가 있는 행정동의 단기체류 외국인 비율(생활인구, ${fmtYm(d.popMonth)} ${d.shareHours[0]}~${d.shareHours[1]}시 평균)을 곱해 1차 추정을 냅니다.`],
        ["× 대여소 이용 행태 보정", `그 대여소의 ${sigName(d)} 비율이 서울 평균보다 높으면 올리고 낮으면 내립니다(0.2~5배). 대여가 적은 대여소는 평균 쪽으로 당겨 우연한 값에 휘둘리지 않게 하고, 서울 전체 합계는 1차 추정과 같게 맞춥니다.`],
      ],
      howWhy: "외국인 체류는 많아도 관광 이동이 적은 곳(예: 김포공항 인근 주거·업무지)은 정기권 이용이 대부분이라 보정 단계에서 낮아집니다.",
      howOff: "이번 기준월은 이용권 자료 응답이 늦어 3단계 보정을 적용하지 못했습니다. 1차 추정(동네 비율)만 표시합니다.",
      mapH: "대여소 지도", dongLayer: "행정동 외국인 비율 색칠",
      metric: { foreign: "외국인 많이", local: "내국인 많이", diff: "외국인·내국인 차이", share: "외국인 비율" },
      cmpH: "외국인 vs 내국인, 어디서 다를까",
      cmpDesc: "같은 따릉이라도 외국인과 내국인이 많이 타는 곳은 다릅니다. 자치구별로 서울 전체 이용 중 몇 %가 그 구에서 나왔는지 비교했습니다.",
      cmpInsight: (top, f, l) => `외국인 추정 이용의 ${f}가 ${top} 세 구에서 나오지만, 내국인 이용은 같은 세 구에서 ${l}만 나옵니다.`,
      cmpFor: "외국인 추정", cmpLoc: "내국인 추정", cmpGuH: "자치구별 이용 비중 (서울 전체 = 100%)",
      cmpListF: "외국인 많이 TOP 10", cmpListL: "내국인 많이 TOP 10",
      cmpOverlap: (n) => (n ? `두 목록에 모두 든 대여소: ${n}곳` : "두 목록에 겹치는 대여소가 없습니다. 외국인과 내국인이 많이 타는 곳이 완전히 다릅니다."),
      both: "공통",
      lqLabels: ["내국인 위주", "내국인 쪽", "서울 평균 수준", "외국인 쪽", "외국인 위주"],
      legendLq: "외국인 상대 비중 (서울 평균 대비)", legendUse: "원 크기: 월 대여",
      mapDesc: {
        foreign: "원 크기 = 외국인 추정 월 대여 건수. 상위 대여소일수록 큽니다.",
        local: "원 크기 = 내국인 추정 월 대여 건수.",
        share: "색 = 대여소가 있는 동의 단기체류 외국인 비율(07~22시). 진할수록 외국인 비율이 높습니다.",
        diff: "색 = 대여소 이용 중 외국인 추정 비중이 서울 평균보다 높으면 주황, 낮으면 파랑. 원 크기 = 월 대여 건수.",
      },
      rankH: { foreign: "외국인 추정 이용 상위 대여소", local: "내국인 추정 이용 상위 대여소", share: "외국인 비율 높은 대여소", diff: "외국인 비중이 서울 평균보다 높은 대여소" },
      rankDesc: (n) => `상위 ${TOP}곳. 이름을 누르면 지도에서 위치를 보여줍니다.` + (n ? ` 비율 순위는 월 대여 ${n}건 이상만.` : ""),
      th: { no: "순위", name: "대여소", dong: "행정동", use: "월 대여", foreign: "외국인 추정", base: "보정 전", local: "내국인 추정", share: "동 외국인 비율", day: "비회원 추정" },
      dongH: "외국인 추정 이용이 많은 행정동", dongDesc: "대여소를 행정동별로 합친 값입니다.",
      thDong: { dong: "행정동", stations: "대여소", use: "월 대여", foreign: "외국인 추정", share: "외국인 비율" },
      legendSize: "원 크기: 추정 건수", legendShare: "외국인 비율",
      methodH: "추정 방법",
      method: (d) => [
        `1차 추정: 대여소별 ${fmtYm(d.month)} 월 대여 건수 × 대여소가 속한 행정동의 단기체류 외국인 비율. 나머지는 내국인 추정 이용입니다.`,
        `외국인 비율 = 단기체류 외국인 생활인구 ÷ (내국인 + 단기체류 외국인 생활인구), ${fmtYm(d.popMonth)} 전체 일 ${d.shareHours[0]}~${d.shareHours[1]}시 평균.`,
        d.adjust ? `행태 보정: 배수 = (대여소 ${sigName(d)} 건수 + 50 × 서울 평균 비율) ÷ (대여소 대여 + 50) ÷ 서울 평균 비율(${pct(d.adjust.cityVisitorRatio)}), 0.2~5배로 제한. 보정 후 서울 전체 외국인 추정 합계가 1차 추정과 같도록 비례 조정합니다. 국내 휴대폰 본인인증이 필요한 회원 가입이 어려운 외국인 관광객은 비회원으로 빌리는 경우가 많고, 비회원은 생년 정보가 없어 연령이 '기타'로 집계된다는 점을 근거로 합니다. 일일권 전체 비율은 한강 나들이 등 내국인 여가 이용까지 섞여 쓰지 않았습니다.`
          : "행태 보정: 이번 기준월은 이용권 자료 응답이 늦어 적용하지 못했습니다.",
      ],
      limitsH: "한계",
      limits: [
        "실제 외국인 이용 건수가 아닙니다. 따릉이는 이용자 국적을 공개하지 않습니다.",
        "비회원 일일권은 외국인만 쓰는 것이 아닙니다(가끔 타는 내국인 포함). 그래서 동네 외국인 비율을 출발점으로 두고, 이용권 비율은 대여소 간 배분을 조정하는 데만 씁니다.",
        "대여(빌린 곳)만 집계합니다. 반납 장소와 시간대별 이용은 반영하지 않습니다.",
        "외국인 비율은 낮·저녁(07~22시) 평균이라 심야 이용 특성은 반영되지 않습니다.",
        "개인 단위 대여 이력은 쓰지 않고, 서울시가 공개한 집계 자료만 사용합니다.",
      ],
      updated: (t) => `업데이트 ${t}`, tipUse: "월 대여", tipForeign: "외국인 추정", tipLocal: "내국인 추정", tipShare: "동 외국인 비율", tipDay: "비회원 추정", tipBase: "보정 전",
      unit: "건", noData: "아직 분석 결과가 없어요.",
    },
    en: {
      title: "Seoul Bike (Ttareungyi): visitor vs resident use", sub: "Monthly rentals × neighbourhood foreigner share × station behaviour adjustment",
      lang: "한국어", note: "These are estimates. Seoul does not publish riders' nationality, so we estimate from public aggregated data. The method is right below.",
      loading: "Loading…", error: "Couldn't load the data.",
      kStations: "Stations", kUse: "Monthly rentals", kForeign: "Est. foreign rentals", kShare: "Seoul average share", kDay: "Likely non-member share",
      howH: "How we estimate",
      howSteps: (d) => [
        ["Monthly rentals per station", `Start from Seoul's published rentals per bike station for ${fmtYm(d.month)} (aggregated data).`],
        ["× neighbourhood foreigner share", `Multiply by the short-stay foreigner share of the station's neighbourhood (living population, ${fmtYm(d.popMonth)}, ${d.shareHours[0]}:00–${d.shareHours[1]}:59 average).`],
        ["× station behaviour adjustment", `Raise or lower each station by how its ${sigName(d)} share compares with the Seoul average (0.2–5×). Small stations are pulled toward the average, and the Seoul total stays equal to step 2.`],
      ],
      howWhy: "Places where many foreigners stay but few tour around (e.g. homes and offices near Gimpo Airport) are mostly season-pass riders, so the adjustment lowers them.",
      howOff: "The pass-type data was too slow this month, so step 3 was not applied. Showing the step-2 estimate only.",
      mapH: "Station map", dongLayer: "Shade neighbourhoods by foreigner share",
      metric: { foreign: "Most foreign use", local: "Most resident use", diff: "Foreign vs resident", share: "Foreigner share" },
      cmpH: "Foreign vs resident: where do they differ?",
      cmpDesc: "Visitors and residents ride Seoul Bike in different places. Each district's share of all Seoul rentals is compared for both groups.",
      cmpInsight: (top, f, l) => `${f} of estimated foreign rentals come from ${top}, but only ${l} of resident rentals do.`,
      cmpFor: "Est. foreign", cmpLoc: "Est. resident", cmpGuH: "Share of rentals by district (Seoul = 100%)",
      cmpListF: "Top 10 by foreign use", cmpListL: "Top 10 by resident use",
      cmpOverlap: (n) => (n ? `Stations in both lists: ${n}` : "No station is in both lists: visitors and residents ride in completely different places."),
      both: "both",
      lqLabels: ["Mostly residents", "Resident-leaning", "Seoul average", "Foreign-leaning", "Mostly foreign"],
      legendLq: "Foreign share vs Seoul average", legendUse: "Circle size: rentals",
      mapDesc: {
        foreign: "Circle size = estimated monthly rentals by foreigners.",
        local: "Circle size = estimated monthly rentals by residents.",
        share: "Colour = short-stay foreigner share of the station's neighbourhood (7am–10pm). Darker = higher.",
        diff: "Colour = orange where the estimated foreign share of rentals is above the Seoul average, blue where it is below. Size = monthly rentals.",
      },
      rankH: { foreign: "Top stations by estimated foreign use", local: "Top stations by estimated resident use", share: "Stations with the highest foreigner share", diff: "Stations most above the Seoul foreign share" },
      rankDesc: (n) => `Top ${TOP}. Tap a name to locate it on the map.` + (n ? ` Share ranking only includes stations with ${n}+ rentals a month.` : ""),
      th: { no: "#", name: "Station", dong: "Neighbourhood", use: "Rentals", foreign: "Est. foreign", base: "Before adj.", local: "Est. resident", share: "Area foreign share", day: "Likely non-member" },
      dongH: "Neighbourhoods with the most estimated foreign use", dongDesc: "Stations summed by neighbourhood (dong).",
      thDong: { dong: "Neighbourhood", stations: "Stations", use: "Rentals", foreign: "Est. foreign", share: "Foreign share" },
      legendSize: "Circle size: estimated rentals", legendShare: "Foreigner share",
      methodH: "Method",
      method: (d) => [
        `Step 2 estimate: monthly rentals per station (${fmtYm(d.month)}) × short-stay foreigner share of the station's neighbourhood. The rest is counted as resident use.`,
        `Foreigner share = short-stay foreign living population ÷ (resident + short-stay foreign), ${fmtYm(d.popMonth)}, all days, ${d.shareHours[0]}:00–${d.shareHours[1]}:59 average.`,
        d.adjust ? `Adjustment: multiplier = (station ${sigName(d)} rentals + 50 × Seoul ratio) ÷ (station rentals + 50) ÷ Seoul ratio (${pct(d.adjust.cityVisitorRatio)}), capped to 0.2–5×, then rescaled so the Seoul total matches step 2. Visitors can rarely complete Korean phone verification for membership, so they often ride as non-members, whose age is recorded as 'other'. The overall day-pass share was not used because it also captures residents' leisure rides (e.g. along the Han River).`
          : "Adjustment: not applied this month because the pass-type data was too slow.",
      ],
      limitsH: "Limitations",
      limits: [
        "Not actual foreign rider counts: Seoul does not publish riders' nationality.",
        "Non-member day passes are not used only by foreigners, so the neighbourhood share stays the starting point and the pass ratio only shifts the split between stations.",
        "Only rentals (pick-ups) are counted; returns and hour-by-hour use are not.",
        "The foreigner share is a 7am–10pm average, so late-night patterns are not reflected.",
        "Only aggregated public data is used; no individual trip records.",
      ],
      updated: (t) => `Updated ${t}`, tipUse: "Rentals", tipForeign: "Est. foreign", tipLocal: "Est. resident", tipShare: "Area foreign share", tipDay: "Likely non-member", tipBase: "Before adj.",
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
  const SIG = {
    비회원: { ko: "비회원 일일권", en: "non-member day-pass" },
    기타: { ko: "연령 미상(비회원 추정)", en: "unknown-age (likely non-member)" },
    일일: { ko: "일일권", en: "day-pass" },
  };
  const sigName = (d) => (SIG[d.adjust && d.adjust.signal] || SIG.비회원)[state.lang];
  const cityRatio = () => data.stats.foreign / Math.max(1, data.stats.foreign + data.stats.local);
  const lqOf = (s) => (s.use > 0 ? s.foreign / s.use / Math.max(1e-9, cityRatio()) : 1);
  const lqBin = (v) => LQ_BREAKS.filter((b) => v >= b).length;   // 0..4
  function lqStyle(bin) {
    if (bin === 2) return { fillColor: "#a8a29a", fillOpacity: 0.55 };
    const c = bin > 2 ? COLOR.foreign : COLOR.local;
    return { fillColor: c, fillOpacity: bin === 0 || bin === 4 ? 0.9 : 0.45 };
  }
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
      state.metric === "diff" ? el("span", { class: "tip-row", text: `${t("legendLq")}: ×${lqOf(s).toFixed(2)} (${t("lqLabels")[lqBin(lqOf(s))]})` }) : null,
      Number.isFinite(s.foreignBase) && data.adjust ? el("span", { class: "tip-row", text: `${t("tipBase")} ${nf(s.foreignBase)}${t("unit")} → ${nf(s.foreign)}${t("unit")} (×${s.mult})` }) : null,
      el("span", { class: "tip-row", text: `${t("tipShare")} ${pct(s.share)}` + (Number.isFinite(s.visitorRatio) ? ` · ${t("tipDay")} ${pct(s.visitorRatio)}` : "") }));
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
      kpi(t("kDay"), d.adjust ? pct(d.adjust.cityVisitorRatio) : "-", d.adjust ? sigName(d) : null));
    renderHow(d);
    $("metric-chips").replaceChildren(...METRICS.map((m) => el("button", {
      type: "button", class: "chip" + (state.metric === m ? " active" : ""), "aria-pressed": String(state.metric === m),
      text: t("metric")[m], onclick: () => { state.metric = m; writeUrl(); renderData(); drawStations(); },
    })));
    $("map-desc").textContent = t("mapDesc")[state.metric];
    renderLegend();
    renderRank();
    renderDongs();
    renderCompare();
    $("method").replaceChildren(...t("method")(d).map((x) => el("p", { text: x })));
    const when = new Date(d.generatedAt);
    $("updated").textContent = t("updated")(isNaN(when) ? "-" : when.toLocaleString(state.lang === "ko" ? "ko-KR" : "en-US", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }) + " KST");
    $("sources").replaceChildren(...d.sources.map((x) => el("li", { text: x })));
  }
  // 상단 '이렇게 추정했어요' 상자
  function renderHow(d) {
    $("how-h").textContent = t("howH");
    $("how-steps").replaceChildren(...t("howSteps")(d).map(([h, p], i) => el("li", { class: i === 2 && !d.adjust ? "off" : null },
      el("strong", { text: h }), el("span", { text: p }))));
    $("how-note").textContent = d.adjust ? t("howWhy") : t("howOff");
    $("how").hidden = false;
  }
  function kpi(label, value, sub) {
    return el("div", { class: "kpi" }, el("p", { class: "k-label", text: label }), el("p", { class: "k-value", text: value }), sub ? el("p", { class: "k-sub", text: sub }) : null);
  }

  function ranked() {
    const m = state.metric;
    if (m === "share") return data.stations.filter((x) => x.use >= data.minUse).sort((a, b) => b.share - a.share || b.use - a.use).slice(0, TOP);
    if (m === "diff") return data.stations.filter((x) => x.use >= 300).sort((a, b) => lqOf(b) - lqOf(a) || b.use - a.use).slice(0, TOP);
    return [...data.stations].sort((a, b) => b[m] - a[m]).slice(0, TOP);
  }
  function renderRank() {
    const th = t("th");
    $("rank-h").textContent = t("rankH")[state.metric];
    $("rank-desc").textContent = t("rankDesc")(state.metric === "share" ? data.minUse : state.metric === "diff" ? 300 : 0);
    const rows = ranked();
    const key = state.metric === "share" || state.metric === "diff" ? "use" : state.metric;
    const max = Math.max(1, ...rows.map((r) => r[key]));
    $("rank").replaceChildren(
      el("thead", {}, el("tr", {}, ...[th.no, th.name, th.dong, th.use, th.foreign, th.base, th.local, th.day, th.share].map((h, i) => el("th", { class: i >= 3 ? "num" : null, text: h })))),
      el("tbody", {}, ...rows.map((r, i) => el("tr", {},
        el("td", { class: "num", text: String(i + 1) }),
        el("td", { class: "rank-name" }, el("button", { type: "button", class: "link", text: r.name, onclick: () => focusStation(r.no) }),
          el("span", { class: "mini-bar", "aria-hidden": "true" }, el("span", { style: null }))),
        el("td", { text: r.dong }),
        el("td", { class: "num", text: nf(r.use) }),
        el("td", { class: "num", text: nf(r.foreign) }),
        el("td", { class: "num", text: Number.isFinite(r.foreignBase) ? nf(r.foreignBase) : "-" }),
        el("td", { class: "num", text: nf(r.local) }),
        el("td", { class: "num", text: Number.isFinite(r.visitorRatio) ? pct(r.visitorRatio) : "-" }),
        el("td", { class: "num", text: pct(r.share) })))));
    // 막대 너비는 CSSOM으로(인라인 style 속성 없이: CSP style-src 'self')
    $("rank").querySelectorAll(".mini-bar > span").forEach((b, i) => { b.style.width = `${(rows[i][key] / max) * 100}%`; });
  }
  // ---------- 외국인 vs 내국인 비교 ----------
  function renderCompare() {
    const gu = new Map();
    for (const s of data.stations) {
      const g = gu.get(s.gu) || { f: 0, l: 0 };
      g.f += s.foreign; g.l += s.local; gu.set(s.gu, g);
    }
    const F = data.stats.foreign || 1, Lc = data.stats.local || 1;
    const rows = [...gu].map(([name, v]) => ({ name, f: v.f / F, l: v.l / Lc })).sort((a, b) => b.f - a.f);
    const top3 = rows.slice(0, 3);
    const sep = state.lang === "ko" ? "·" : ", ";
    $("cmp-h").textContent = t("cmpH");
    $("cmp-desc").textContent = t("cmpDesc");
    $("cmp-insight").textContent = t("cmpInsight")(top3.map((r) => r.name).join(sep), pct(top3.reduce((a, r) => a + r.f, 0)), pct(top3.reduce((a, r) => a + r.l, 0)));
    $("cmp-gu-h").textContent = t("cmpGuH");
    const dot = (c) => { const d = el("span", { class: "legend-dot" }); d.style.width = d.style.height = "10px"; d.style.background = c; return d; };
    $("cmp-legend").replaceChildren(el("span", {}, dot(COLOR.foreign), ` ${t("cmpFor")}`), el("span", {}, dot(COLOR.local), ` ${t("cmpLoc")}`));
    const shown = rows.slice(0, 10);
    const max = Math.max(...shown.map((r) => Math.max(r.f, r.l)), 0.01);
    $("cmp-gu").replaceChildren(...shown.map((r) => {
      const bf = el("span", { class: "cbar for" }), bl = el("span", { class: "cbar loc" });
      bf.style.width = `${(r.f / max) * 100}%`; bl.style.width = `${(r.l / max) * 100}%`;
      bf.style.background = COLOR.foreign; bl.style.background = COLOR.local;
      const tip = `${r.name} — ${t("cmpFor")} ${pct(r.f)} · ${t("cmpLoc")} ${pct(r.l)}`;
      return el("li", { class: "cmp-row", title: tip, tabindex: "0", "aria-label": tip },
        el("span", { class: "cmp-name", text: r.name }),
        el("span", { class: "cmp-bars", "aria-hidden": "true" }, bf, bl),
        el("span", { class: "cmp-val", "aria-hidden": "true" }, el("span", { text: pct(r.f) }), el("span", { class: "muted", text: pct(r.l) })));
    }));
    // TOP 10 두 목록과 겹침
    const tf = [...data.stations].sort((a, b) => b.foreign - a.foreign).slice(0, 10);
    const tl = [...data.stations].sort((a, b) => b.local - a.local).slice(0, 10);
    const both = new Set(tf.filter((x) => tl.some((y) => y.no === x.no)).map((x) => x.no));
    const list = (arr, key, c) => el("ol", { class: "cmp-list" }, ...arr.map((s) => {
      const d = dot(c);
      return el("li", {}, d,
        el("span", { class: "cmp-who" }, el("button", { type: "button", class: "link", text: s.name, onclick: () => focusStation(s.no) }),
          el("span", { class: "muted", text: ` ${s.gu}` }), both.has(s.no) ? el("span", { class: "tag", text: ` ${t("both")}` }) : null),
        el("span", { class: "cmp-num", text: nf(s[key]) }));
    }));
    $("cmp-lists").replaceChildren(
      el("div", {}, el("h3", { text: t("cmpListF") }), list(tf, "foreign", COLOR.foreign)),
      el("div", {}, el("h3", { text: t("cmpListL") }), list(tl, "local", COLOR.local)));
    $("cmp-overlap").textContent = t("cmpOverlap")(both.size);
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
    if (state.metric === "diff") {
      items.push(el("span", { class: "legend-group" }, el("span", { class: "legend-title", text: t("legendLq") }),
        ...t("lqLabels").map((lbl, i) => {
          const st = lqStyle(i);
          const dot = el("span", { class: "legend-dot" }); dot.style.width = dot.style.height = "12px";
          dot.style.background = st.fillColor; dot.style.opacity = String(Math.max(0.55, st.fillOpacity));
          return el("span", {}, dot, ` ${lbl}`);
        })));
      items.push(el("span", { class: "legend-group", text: t("legendUse") }));
    } else if (state.metric !== "share") {
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
    const key = m === "diff" ? "use" : m;
    const max = Math.max(1, ...data.stations.map((s) => (m === "share" ? 0 : s[key])));
    const list = m === "share" ? data.stations : [...data.stations].sort((a, b) => a[key] - b[key]);   // 큰 원이 위로
    stationLayer = L.layerGroup(list.map((s) => {
      const style = m === "share"
        ? { radius: 4, color: "#ffffff", weight: 0.8, fillColor: shareColor(s.share), fillOpacity: 0.95 }
        : m === "diff"
          ? { radius: 2 + 12 * Math.sqrt(s.use / max), color: "#ffffff", weight: 0.8, ...lqStyle(lqBin(lqOf(s))) }
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
