// 오프라인 경로 엔진: 도보·지하철·버스·환승, 심야버스, 장소 해석(다국어·id), 지도 링크, 도구 출력
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, planRoute, resolvePlace, mapLinks, haversineM, walkMin } from "../src/transit.js";
import { executeTool } from "../src/tools.js";

// 가상의 작은 노선망(좌표는 시험용)
const st = (id, ko, en, lat, lng, line) => ({ id, line, fr: "", lat, lng, name: { ko, en, ja: ko + "駅", zh: ko + "站" } });
const NET = {
  subway: {
    stations: [
      st("A", "명동", "Myeongdong", 37.5609, 126.9863, "4호선"),
      st("B", "충무로", "Chungmuro", 37.5613, 126.9946, "4호선"),
      st("C", "동대문역사문화공원", "Dongdaemun History & Culture Park", 37.5652, 127.0090, "4호선"),
      st("D", "동대문역사문화공원", "Dongdaemun History & Culture Park", 37.5652, 127.0090, "2호선"),
      st("E", "신당", "Sindang", 37.5657, 127.0176, "2호선"),
      st("F", "상왕십리", "Sangwangsimni", 37.5643, 127.0293, "2호선"),
    ],
    edges: [["A", "B", 0.74], ["B", "C", 1.4], ["D", "E", 0.77], ["E", "F", 1.05]],
  },
  bus: [
    { no: "N99", stops: [["명동입구", 37.5612, 126.9858], ["상왕십리역", 37.5640, 127.0290]] },
    { no: "100", stops: [["명동입구", 37.5612, 126.9858], ["충무로역", 37.5610, 126.9940], null, ["끊긴구간", 37.6, 127.1]] },
  ],
};
const g = buildGraph(NET);
const P = (lat, lng) => ({ lat, lng, name: { ko: "x" } });

test("가까우면 도보 안내", () => {
  const r = planRoute(g, P(37.5609, 126.9863), P(37.5613, 126.9900), "en");
  assert.ok(r.walk && r.walk.minutes <= 6);
});

test("지하철 환승 경로: 4호선 → 동대문역사문화공원 → 2호선, 다국어 역명", () => {
  const r = planRoute(g, P(37.5609, 126.9863), P(37.5643, 127.0293), "en", "subway");
  const op = r.options[0];
  assert.equal(op.transfers, 1);
  const rides = op.legs.filter((l) => l.mode === "subway");
  assert.deepEqual(rides.map((l) => l.line), ["4호선", "2호선"]);
  assert.equal(rides[0].from, "Myeongdong");
  assert.equal(rides[1].to, "Sangwangsimni");
  assert.equal(r.walk, null);   // 3km 이상: 도보만 안내 안 함
  const ja = planRoute(g, P(37.5609, 126.9863), P(37.5643, 127.0293), "ja", "subway");
  assert.equal(ja.options[0].legs.find((l) => l.mode === "subway").from, "명동駅");
});

test("심야버스(N)는 night일 때만", () => {
  const day = planRoute(g, P(37.5612, 126.9858), P(37.5640, 127.0290), "en", "bus");
  assert.ok(!day.options.some((o) => o.legs.some((l) => l.line === "N99")));
  const night = planRoute(g, P(37.5612, 126.9858), P(37.5640, 127.0290), "en", "bus", true);
  assert.ok(night.options[0].legs.some((l) => l.line === "N99"));
  assert.ok(night.options[0].legs.find((l) => l.mode === "bus").names_in_korean);
});

test("서울 밖 구간(null)은 잇지 않음", () => {
  const r = planRoute(g, P(37.5612, 126.9858), P(37.6, 127.1), "en", "bus");
  assert.equal(r.options.length, 0);
});

test("장소 해석: 역 이름(다국어)·별칭·모르는 곳", () => {
  const ctx = { stations: NET.subway.stations };
  assert.equal(resolvePlace("Chungmuro Station", null, ctx).kind, "station");
  assert.equal(resolvePlace("충무로역", null, ctx).name.en, "Chungmuro");
  const md = resolvePlace("I'm in 明洞", null, ctx);
  assert.equal(md.kind, "area");
  assert.equal(md.lat, 37.5609);   // 역 데이터가 있으면 같은 이름 역 좌표
  assert.equal(resolvePlace("N Seoul Tower", null, {}).name.ko, "N서울타워");
  assert.equal(resolvePlace("Busan", null, ctx), null);
  assert.equal(resolvePlace("", null, ctx), null);
});

test("지도 링크: 구글(대중교통·도보), 네이버 검색, 카카오는 한국어만, 주입 문자 제거", () => {
  const l = mapLinks({ lat: 37.5609, lng: 126.9863 }, { lat: 37.5701, lng: 126.9996 }, "광장시장", "en");
  assert.equal(l.google_transit, "https://www.google.com/maps/dir/?api=1&origin=37.560900,126.986300&destination=37.570100,126.999600&travelmode=transit");
  assert.ok(l.google_walking.endsWith("travelmode=walking"));
  assert.equal(l.naver, "https://map.naver.com/p/search/%EA%B4%91%EC%9E%A5%EC%8B%9C%EC%9E%A5");
  assert.equal(l.kakao, undefined);
  const ko = mapLinks(null, { lat: 37.5, lng: 127 }, "a,b/c?d", "ko");
  assert.ok(!ko.google_transit.includes("origin="));   // 출발지를 모르면 앱이 현재 위치 사용
  assert.ok(ko.kakao.startsWith("https://map.kakao.com/link/to/a%20b%20c%20d,"));
});

test("도보 시간 추정 공식", () => {
  assert.equal(Math.round(walkMin(750)), 13);   // 750m × 1.3 ÷ 75m/분
  assert.ok(Math.abs(haversineM({ lat: 37.5609, lng: 126.9863 }, { lat: 37.5701, lng: 126.9996 }) - 1555) < 30);
});

test("plan_route 도구: 결과·팁·링크, 출발지 모름, 목적지 모름, id로 목적지", async () => {
  const ctx = { lang: "en", getTransit: async () => NET,
    getFeed: async () => ({ events: [{ id: "abc123def456", title: "축제", place: "상왕십리광장", lat: 37.5643, lng: 127.0293 }] }) };
  const r = (await executeTool("plan_route", { origin: "Myeongdong", destination: "Sangwangsimni", mode: "subway" }, ctx)).result;
  assert.equal(r.found, true);
  assert.equal(r.estimated, true);
  assert.equal(r.options[0].transfers, 1);
  assert.ok(r.tips.some((t) => t.text.includes("exits 5-8")) && r.tips.every((t) => t.is_sample));
  assert.ok(r.links.google_transit.startsWith("https://www.google.com/maps/dir/"));
  const noOrigin = (await executeTool("plan_route", { destination: "Myeongdong" }, ctx)).result;
  assert.equal(noOrigin.reason, "origin_unknown");
  assert.ok(!noOrigin.links.google_transit.includes("origin="));
  const unknown = (await executeTool("plan_route", { origin: "Myeongdong", destination: "Atlantis" }, ctx)).result;
  assert.equal(unknown.found, false);
  const byId = (await executeTool("plan_route", { origin: "Myeongdong", destination_id: "abc123def456" }, ctx)).result;
  assert.equal(byId.destination.name_ko, "상왕십리광장");
  const noNet = (await executeTool("plan_route", { origin: "Myeongdong", destination: "Hongdae" }, { lang: "en", getTransit: async () => null })).result;
  assert.equal(noNet.options.length, 0);
  assert.ok(noNet.links.naver);
});
