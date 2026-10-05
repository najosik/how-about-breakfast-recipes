// 오프라인 대중교통·도보 경로 엔진(plan_route 도구).
// 입력: transit_network.json(지하철 역·구간, 버스 노선별 정류장 순서). 소요시간은 거리 기반 추정치다.
// 실시간 정보·정확한 경로는 지도 앱 링크(구글·네이버·카카오)로 넘긴다. 사용자 위치(GPS)는 받지 않는다.

const WALK_M_PER_MIN = 75;        // 보행 속도
const DETOUR = 1.3;               // 직선거리 → 실제 보행거리
const ACCESS_M = 700;             // 출발·도착 지점에서 정류장·역까지 걸어갈 최대 거리
const TRANSFER_M = 300;           // 정류장↔역 도보 환승 최대 거리
const WAIT = { subway: 3, bus: 6 };   // 평균 대기(배차 간격 절반 가정)
const BOARD_PENALTY = 2;          // 환승을 줄이도록 탑승마다 더하는 가중치(표시 시간에는 미포함)
const rideMin = { subway: (km) => 0.8 + km * 1.4, bus: (km) => 0.6 + km * 3.0 };
export const WALK_ONLY_MAX_MIN = 20;

export function haversineM(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}
export const walkMin = (m) => (m * DETOUR) / WALK_M_PER_MIN;

// ---------- 그래프 ----------
class Heap {
  constructor() { this.a = []; }
  push(n, d) { const a = this.a; a.push([d, n]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

/** 노드: hub(정류장·역, 걸어서 닿는 지점) / ride(노선 위의 정류장). 간선 종류: board·alight·ride·walk. */
const graphCache = new WeakMap();
/** 같은 노선망이면 그래프를 다시 만들지 않는다(구성 약 0.4초). */
export function getGraph(net) {
  let g = graphCache.get(net);
  if (!g) { g = buildGraph(net); graphCache.set(net, g); }
  return g;
}

export function buildGraph(net) {
  const nodes = [];        // {kind, lat, lng, name, mode?, route?, hub?}
  const adj = [];          // [[to, minutes, type]]
  const add = (n) => { nodes.push(n); adj.push([]); return nodes.length - 1; };
  const link = (a, b, w, type) => adj[a].push([b, w, type]);
  const hubs = [];
  const hubKey = new Map();
  const hubOf = (key, lat, lng, name) => {
    let h = hubKey.get(key);
    if (h === undefined) { h = add({ kind: "hub", lat, lng, name }); hubKey.set(key, h); hubs.push(h); }
    return h;
  };
  const sub = net && net.subway ? net.subway : { stations: [], edges: [] };
  const stationRide = new Map();
  for (const s of Array.isArray(sub.stations) ? sub.stations : []) {
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lng) || !s.name || !s.name.ko) continue;
    const hub = hubOf(`st:${s.name.ko}`, s.lat, s.lng, { ...s.name, station: true });
    const r = add({ kind: "ride", mode: "subway", route: s.line, lat: s.lat, lng: s.lng, name: { ...s.name, station: true }, hub });
    stationRide.set(s.id, r);
    link(hub, r, WAIT.subway + BOARD_PENALTY, "board");
    link(r, hub, 0, "alight");
  }
  for (const e of Array.isArray(sub.edges) ? sub.edges : []) {
    const a = stationRide.get(e[0]), b = stationRide.get(e[1]);
    if (a === undefined || b === undefined || !(e[2] >= 0)) continue;
    const w = rideMin.subway(e[2]);
    link(a, b, w, "ride"); link(b, a, w, "ride");
  }
  for (const route of Array.isArray(net && net.bus) ? net.bus : []) {
    let prev = null;
    for (const s of Array.isArray(route.stops) ? route.stops : []) {
      if (!Array.isArray(s)) { prev = null; continue; }   // 서울 밖 구간에서 끊김
      const [name, lat, lng] = s;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) { prev = null; continue; }
      const hub = hubOf(`b:${lat},${lng}`, lat, lng, { ko: String(name || "").slice(0, 40) });
      const no = String(route.no || "").slice(0, 12);
      const r = add({ kind: "ride", mode: "bus", route: no, night: /^N\d/.test(no), lat, lng, name: nodes[hub].name, hub });
      link(hub, r, WAIT.bus + BOARD_PENALTY, "board");
      link(r, hub, 0, "alight");
      if (prev !== null) link(prev, r, rideMin.bus(haversineM(nodes[prev], nodes[r]) / 1000), "ride");
      prev = r;
    }
  }
  // 정류장·역 사이 도보 환승(격자 색인으로 가까운 것만)
  const grid = new Map();
  const cell = (lat, lng) => `${Math.floor(lat / 0.003)},${Math.floor(lng / 0.004)}`;
  for (const h of hubs) { const k = cell(nodes[h].lat, nodes[h].lng); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(h); }
  const near = (p, maxM) => {
    const out = [];
    const cy = Math.floor(p.lat / 0.003), cx = Math.floor(p.lng / 0.004);
    const ry = Math.ceil(maxM / 330), rx = Math.ceil(maxM / 350);
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      for (const h of grid.get(`${y},${x}`) || []) { const d = haversineM(p, nodes[h]); if (d <= maxM) out.push([h, d]); }
    }
    return out;
  };
  for (const h of hubs) for (const [o, d] of near(nodes[h], TRANSFER_M)) if (o !== h) link(h, o, walkMin(d), "walk");
  return { nodes, adj, near, counts: { hubs: hubs.length, nodes: nodes.length } };
}

function dijkstra(g, origin, dest, allow) {
  const N = g.nodes.length, SRC = N, DST = N + 1;
  const dist = new Float64Array(N + 2).fill(Infinity);
  const prev = new Int32Array(N + 2).fill(-1);
  const prevType = new Array(N + 2);
  const destEdges = new Map(g.near(dest, ACCESS_M).map(([h, d]) => [h, walkMin(d)]));
  const heap = new Heap();
  dist[SRC] = 0; heap.push(SRC, 0);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    if (u === DST) break;
    const edges = u === SRC ? g.near(origin, ACCESS_M).map(([h, m]) => [h, walkMin(m), "walk"]) : g.adj[u] || [];
    for (const [v, w, type] of edges) {
      if (type === "board" && (!allow[g.nodes[v].mode] || (g.nodes[v].night && !allow.night))) continue;
      const nd = d + w;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevType[v] = type; heap.push(v, nd); }
    }
    if (destEdges.has(u)) {
      const nd = d + destEdges.get(u);
      if (nd < dist[DST]) { dist[DST] = nd; prev[DST] = u; prevType[DST] = "walk"; heap.push(DST, nd); }
    }
  }
  if (!Number.isFinite(dist[DST])) return null;
  const path = [];
  for (let v = DST; v !== -1; v = prev[v]) path.push(v);
  path.reverse();
  return { path, prevType };
}

const nameIn = (n, lang) => {
  if (!n) return "";
  const k = lang === "zh-CN" || lang === "zh-TW" ? "zh" : lang;
  return (n[k] && String(n[k])) || n.ko || "";
};

function toLegs(g, res, origin, dest, lang) {
  const N = g.nodes.length;
  const pt = (v) => (v === N ? origin : v === N + 1 ? dest : g.nodes[v]);
  const legs = [];
  let walkM = 0;
  const pushWalk = (a, b) => {
    const m = haversineM(pt(a), pt(b));
    walkM += m;
    const last = legs[legs.length - 1];
    if (last && last.mode === "walk") { last.meters += m; last.to = b; } else legs.push({ mode: "walk", from: a, to: b, meters: m });
  };
  const { path, prevType } = res;
  for (let i = 1; i < path.length; i++) {
    const v = path[i], u = path[i - 1], type = prevType[v];
    if (type === "walk") pushWalk(u, v);
    else if (type === "board") legs.push({ mode: g.nodes[v].mode, route: g.nodes[v].route, fromNode: v, toNode: v, stops: 0, minutes: WAIT[g.nodes[v].mode], wait: WAIT[g.nodes[v].mode] });
    else if (type === "ride") { const l = legs[legs.length - 1]; l.toNode = v; l.stops += 1; }
  }
  let total = 0, rides = 0;
  const out = legs.map((l) => {
    if (l.mode === "walk") {
      const min = Math.max(1, Math.round(walkMin(l.meters)));
      total += min;
      const end = (v) => (v === N ? "origin" : v === N + 1 ? "destination" : nameIn(g.nodes[v].name, lang));
      return { mode: "walk", from: end(l.from), to: end(l.to), meters: Math.round(l.meters * DETOUR), minutes: min };
    }
    rides += 1;
    const a = g.nodes[l.fromNode], b = g.nodes[l.toNode];
    // 승차~하차 정류장 직선거리 기반 + 정차마다 가산(추정)
    const ride = l.mode === "subway" ? rideMin.subway(haversineM(a, b) / 1000) + l.stops * 0.6 : rideMin.bus(haversineM(a, b) / 1000) + l.stops * 0.5;
    const min = Math.round(l.wait + ride);
    total += min;
    return { mode: l.mode, line: l.route, from: nameIn(a.name, lang), to: nameIn(b.name, lang), stops: l.stops, minutes: min,
      names_in_korean: lang !== "ko" && (l.mode === "bus" || nameIn(a.name, lang) === a.name.ko) };
  }).filter((l) => l.mode !== "walk" || l.minutes > 0);
  return { total_minutes: total, transfers: Math.max(0, rides - 1), walk_meters: Math.round(walkM * DETOUR),
    modes: [...new Set(out.filter((l) => l.mode !== "walk").map((l) => l.mode))], legs: out };
}

/** 경로 계획: 도보만(가까우면) + 최단 대중교통 + 다른 수단 대안 1개. */
export function planRoute(g, origin, dest, lang = "en", mode = "any", night = false) {
  const direct = haversineM(origin, dest);
  const walk = { minutes: Math.max(1, Math.round(walkMin(direct))), meters: Math.round(direct * DETOUR) };
  const options = [];
  const signature = (o) => o.legs.filter((l) => l.mode !== "walk").map((l) => `${l.mode}:${l.line}`).join(">");
  const tryMode = (allow, label) => {
    const r = dijkstra(g, origin, dest, { ...allow, night });
    if (!r) return;
    const o = toLegs(g, r, origin, dest, lang);
    if (!o.modes.length) return;   // 결국 걷기만 한 경로
    if (options.some((x) => signature(x) === signature(o))) return;
    options.push({ label, ...o });
  };
  if (mode !== "walk") {
    if (mode === "any" || mode === "subway") tryMode({ subway: true, bus: mode === "any" }, mode === "subway" ? "subway" : "fastest");
    if (mode === "any") { tryMode({ subway: true, bus: false }, "subway"); tryMode({ subway: false, bus: true }, "bus"); }
    if (mode === "bus") tryMode({ subway: false, bus: true }, "bus");
  }
  options.sort((a, b) => a.total_minutes - b.total_minutes);
  const best = options[0];
  const kept = options.filter((o, i) => i === 0 || o.total_minutes <= best.total_minutes + 15).slice(0, 2);
  return { walk: walk.minutes <= WALK_ONLY_MAX_MIN || mode === "walk" ? walk : null, walk_minutes_direct: walk.minutes, options: kept };
}

// ---------- 장소 해석 ----------
// 관광지 별칭 → 대표 지점 좌표(근사). 지하철 데이터가 있으면 같은 이름 역 좌표를 우선한다.
export const PLACES = [
  { ko: "명동", en: "Myeongdong", ja: "明洞", zh: "明洞", station: "명동", lat: 37.5609, lng: 126.9863 },
  { ko: "홍대", en: "Hongdae", ja: "弘大", zh: "弘大", station: "홍대입구", lat: 37.5572, lng: 126.9245 },
  { ko: "강남", en: "Gangnam", ja: "江南", zh: "江南", station: "강남", lat: 37.4979, lng: 127.0276 },
  { ko: "이태원", en: "Itaewon", ja: "梨泰院", zh: "梨泰院", station: "이태원", lat: 37.5345, lng: 126.9946 },
  { ko: "인사동", en: "Insadong", ja: "仁寺洞", zh: "仁寺洞", station: "안국", lat: 37.5741, lng: 126.9849 },
  { ko: "북촌", en: "Bukchon", ja: "北村", zh: "北村", station: "안국", lat: 37.5826, lng: 126.9836 },
  { ko: "경복궁", en: "Gyeongbokgung", ja: "景福宮", zh: "景福宫", station: "경복궁", lat: 37.5796, lng: 126.9770 },
  { ko: "광화문", en: "Gwanghwamun", ja: "光化門", zh: "光化门", station: "광화문", lat: 37.5710, lng: 126.9768 },
  { ko: "시청", en: "City Hall", ja: "市庁", zh: "市厅", station: "시청", lat: 37.5657, lng: 126.9769 },
  { ko: "동대문", en: "Dongdaemun", ja: "東大門", zh: "东大门", station: "동대문역사문화공원", lat: 37.5665, lng: 127.0092 },
  { ko: "DDP", en: "DDP", ja: "DDP", zh: "DDP", station: "동대문역사문화공원", lat: 37.5671, lng: 127.0095 },
  { ko: "남대문시장", en: "Namdaemun Market", ja: "南大門市場", zh: "南大门市场", station: "회현", lat: 37.5592, lng: 126.9773 },
  { ko: "광장시장", en: "Gwangjang Market", ja: "広蔵市場", zh: "广藏市场", station: "종로5가", lat: 37.5701, lng: 126.9996 },
  { ko: "N서울타워", en: "N Seoul Tower", ja: "Nソウルタワー", zh: "N首尔塔", station: null, lat: 37.5512, lng: 126.9882 },
  { ko: "서울역", en: "Seoul Station", ja: "ソウル駅", zh: "首尔站", station: "서울역", lat: 37.5547, lng: 126.9707 },
  { ko: "성수", en: "Seongsu", ja: "聖水", zh: "圣水", station: "성수", lat: 37.5446, lng: 127.0559 },
  { ko: "여의도", en: "Yeouido", ja: "汝矣島", zh: "汝矣岛", station: "여의도", lat: 37.5216, lng: 126.9243 },
  { ko: "잠실", en: "Jamsil", ja: "蚕室", zh: "蚕室", station: "잠실", lat: 37.5133, lng: 127.1001 },
  { ko: "코엑스", en: "COEX", ja: "COEX", zh: "COEX", station: "삼성", lat: 37.5115, lng: 127.0595 },
  { ko: "김포공항", en: "Gimpo Airport", ja: "金浦空港", zh: "金浦机场", station: "김포공항", lat: 37.5624, lng: 126.8013 },
];
const squash = (s) => String(s || "").toLowerCase().normalize("NFKC")
  .replace(/\s+|station|stn\.?|역|駅|站|입구역$/g, "").replace(/[^\p{L}\p{N}]/gu, "");

/**
 * 장소 해석: 이전 결과의 id(맛집·축제) → 지하철역 이름(다국어) → 관광지 별칭.
 * 찾지 못하면 null(지도 앱 검색 링크만 안내).
 */
export function resolvePlace(text, id, ctx) {
  if (id && typeof id === "string" && ctx.lookupId) {
    const hit = ctx.lookupId(id.slice(0, 40));
    if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) return { ...hit, kind: "result" };
  }
  const q = squash(typeof text === "string" ? text.slice(0, 60) : "");
  if (!q) return null;
  const stations = ctx.stations || [];
  const exact = stations.find((s) => [s.name.ko, s.name.en, s.name.ja, s.name.zh].some((n) => n && squash(n) === q));
  if (exact) return { name: exact.name, lat: exact.lat, lng: exact.lng, kind: "station" };
  const alias = PLACES.find((p) => [p.ko, p.en, p.ja, p.zh].some((n) => q.includes(squash(n))));
  if (alias) {
    const st = alias.station && stations.find((s) => s.name.ko === alias.station);
    const usePlace = !st || alias.station === null;
    return { name: { ko: alias.ko, en: alias.en, ja: alias.ja, zh: alias.zh }, lat: usePlace ? alias.lat : st.lat, lng: usePlace ? alias.lng : st.lng, kind: "area" };
  }
  const partial = q.length >= 2 && stations.find((s) => [s.name.ko, s.name.en].some((n) => n && squash(n).startsWith(q)));
  if (partial) return { name: partial.name, lat: partial.lat, lng: partial.lng, kind: "station" };
  return null;
}

// ---------- 지도 앱 링크 ----------
export function mapLinks(origin, dest, destLabel, lang) {
  const ll = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const g = (mode) => `https://www.google.com/maps/dir/?api=1${origin ? `&origin=${ll(origin)}` : ""}&destination=${ll(dest)}&travelmode=${mode}`;
  const label = String(destLabel || "").replace(/[,/?#]/g, " ").trim().slice(0, 40) || ll(dest);
  const links = { google_transit: g("transit"), google_walking: g("walking"), naver: `https://map.naver.com/p/search/${encodeURIComponent(label)}` };
  if (lang === "ko") links.kakao = `https://map.kakao.com/link/to/${encodeURIComponent(label)},${dest.lat.toFixed(6)},${dest.lng.toFixed(6)}`;
  return links;
}
