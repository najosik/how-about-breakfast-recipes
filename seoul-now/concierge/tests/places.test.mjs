import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rankPlaces, searchPlaces, loadRankingConfig, resolveHour, relevance } from "../src/places.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf-8"));
const PLACES = load("../src/data/places.json");
const CONFIG = load("../src/config/ranking.json");
const isLocal = (r) => r.flags.is_traditional_market || r.flags.is_local_small_business;

const place = (id, cat, flags, extra = {}) => ({ id, category: cat, district: "중구", area: "도심", near: [], tags: [],
  name: { ko: id, en: id }, flags: { is_traditional_market: false, is_local_small_business: false,
    is_night_content: false, is_large_mall_or_duty_free: false, ...flags }, ...extra });

test("샘플 데이터 요건: 카테고리별 8건 이상, 5개 권역, 샘플 표시", () => {
  for (const c of ["food", "shopping", "market", "night"]) {
    const ps = PLACES.filter((p) => p.category === c);
    assert.ok(ps.length >= 8, `${c} ${ps.length}건`);
  }
  assert.deepEqual(new Set(PLACES.map((p) => p.area)), new Set(["도심", "동북", "서북", "서남", "동남"]));
  assert.ok(PLACES.every((p) => p.is_sample === true && p.source === "샘플 데이터" && p.open_hours_note.includes("샘플")));
  for (const f of ["transit", "dsp_products", "info_centers"]) {
    assert.ok(load(`../src/data/${f}.json`).every((x) => x.is_sample === true && x.source === "샘플 데이터"), f);
  }
});

test("가중치 공식: 시장 +0.20, 로컬 +0.15, 야간(18시 이후) +0.15, 대형몰 -0.10", () => {
  const cfg = loadRankingConfig(CONFIG);
  const q = { category: "shopping", regionText: "", district: null, keywords: [], hour: 20 };
  const r = rankPlaces([
    place("mall", "shopping", { is_large_mall_or_duty_free: true }),
    place("local", "shopping", { is_local_small_business: true, is_night_content: true }),
    place("mkt", "market", { is_traditional_market: true, is_local_small_business: true }),
  ], q, cfg).results;
  const s = Object.fromEntries(r.map((x) => [x.place.id, x.score]));
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  close(s.mall, 0.5 - 0.1);
  close(s.local, 0.5 + 0.15 + 0.15);
  close(s.mkt, 0.35 + 0.2 + 0.15);
  const morning = rankPlaces([place("local", "shopping", { is_night_content: true })], { ...q, hour: 10 }, cfg).results[0];
  assert.equal(morning.breakdown.bonus.night_after_18, 0, "18시 이전엔 야간 가중치 없음");
});

test("상위 5개에 로컬이 없으면 5번째를 로컬로 교체(보장)", () => {
  const cfg = loadRankingConfig({ ...CONFIG, weights: { is_traditional_market: 0, is_local_small_business: 0, night_after_18: 0, is_large_mall_or_duty_free: 0 } });
  const malls = [1, 2, 3, 4, 5, 6].map((i) => place(`m${i}`, "shopping", {}, { tags: ["luxury"] }));
  const local = place("z-local", "shopping", { is_local_small_business: true });
  const q = { category: "shopping", regionText: "", district: null, keywords: ["luxury"], hour: null };
  const out = rankPlaces([...malls, local], q, cfg);
  assert.equal(out.guaranteed_local, true);
  assert.equal(out.results.length, 5);
  assert.equal(out.results[4].place.id, "z-local");
});

test("시나리오 2: 쇼핑 질의 상위 5개에 전통시장·로컬 1개 이상(실제 샘플 데이터)", () => {
  for (const region of ["", "Myeongdong", "강남", "홍대", "잠실"]) {
    const out = searchPlaces({ category: "shopping", region }, PLACES, CONFIG, "ja");
    assert.equal(out.results.length, 5);
    assert.ok(out.results.some(isLocal), `region=${region}`);
    assert.ok(out.ranking_policy.includes("ソウル"));
  }
});

test("시나리오 1: 명동 저녁 음식 → 명동 인근 로컬·시장이 상위, 결과마다 점수 내역", () => {
  const out = searchPlaces({ category: "food", region: "Myeongdong", time_of_day: "tonight" }, PLACES, CONFIG);
  assert.equal(out.query.district, "중구");
  assert.equal(out.query.hour, 21);
  assert.equal(out.results[0].district, "중구");
  assert.ok(out.results.every((r) => typeof r.score_breakdown.relevance === "number" && r.is_sample === true));
  const night = searchPlaces({ category: "night", region: "명동", hour: 20 }, PLACES, CONFIG);
  assert.ok(night.results.every((r) => r.flags.is_night_content));
});

test("다양성: 쇼핑 질의 상위 5개 중 전통시장은 최대 2개, 쇼핑 장소가 3개 이상", () => {
  for (const region of ["", "명동", "홍대"]) {
    const r = searchPlaces({ category: "shopping", region }, PLACES, CONFIG).results;
    assert.ok(r.filter((x) => x.category === "market").length <= 2, region);
    assert.ok(r.filter((x) => x.category === "shopping").length >= 3, region);
  }
});

test("결정적 순위: 같은 입력이면 항상 같은 순서", () => {
  const a = searchPlaces({ category: "food" }, PLACES, CONFIG).results.map((r) => r.id);
  const b = searchPlaces({ category: "food" }, [...PLACES].reverse(), CONFIG).results.map((r) => r.id);
  assert.deepEqual(a, b);
});

test("설정·입력 검증: 잘못된 가중치·카테고리·시간은 무시", () => {
  const cfg = loadRankingConfig({ weights: { is_traditional_market: 99, is_local_small_business: "x" }, top_n: 500 });
  assert.equal(cfg.weights.is_traditional_market, 0.2);
  assert.equal(cfg.weights.is_local_small_business, 0.15);
  assert.equal(cfg.topN, 5);
  assert.equal(resolveHour(25, "night"), 21);
  assert.equal(resolveHour(undefined, "<script>"), null);
  const out = searchPlaces({ category: "weapons", keywords: [{}, "x".repeat(500)] }, PLACES, CONFIG);
  assert.equal(out.query.category, "all");
  assert.ok(out.query.keywords.every((k) => k.length <= 30));
  assert.doesNotThrow(() => searchPlaces(null, PLACES, null));
});

test("relevance는 0~1 범위", () => {
  const q = { category: "food", regionText: "명동", district: "중구", keywords: ["street food"], hour: 21 };
  for (const p of PLACES) {
    const r = relevance(p, q).total;
    assert.ok(r >= 0 && r <= 1, p.id);
  }
});
