// node --test seoul-now/concierge/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { searchFestivals, resolveDistrict, normalizeRange, kstToday, loadFeed, FESTIVAL_SOURCE } from "../src/festivals.js";

const ev = (o) => ({ id: "x", title: "행사", category: "축제-문화/예술", district: "중구", place: "광장",
  start: "2026-10-01", end: "2026-10-10", free: true, fee: "", ...o });
const FEED = { updatedAt: "2026-10-04T12:00:00+09:00", events: [
  ev({ id: "a", title: "명동 거리 축제" }),
  ev({ id: "b", title: "지난 축제", start: "2026-09-01", end: "2026-09-30" }),
  ev({ id: "c", title: "강남 축제", district: "강남구", start: "2026-10-05" }),
  ev({ id: "d", title: "클래식 공연", category: "클래식" }),
  ev({ id: "e", title: "<script>x</script>", link: "javascript:alert(1)" }),
  { title: "깨진 데이터", start: "bad" },
] };
const TODAY = "2026-10-04";

test("resolveDistrict: 한/영/일/중 지역명", () => {
  assert.equal(resolveDistrict("I'm near Myeongdong"), "중구");
  assert.equal(resolveDistrict("明洞"), "중구");
  assert.equal(resolveDistrict("홍대 근처"), "마포구");
  assert.equal(resolveDistrict("강남구"), "강남구");
  assert.equal(resolveDistrict("somewhere"), null);
  assert.equal(resolveDistrict(undefined), null);
});

test("normalizeRange: 과거 시작일은 오늘로, 기본 7일, 최대 31일", () => {
  assert.deepEqual(normalizeRange("2026-01-01", "2026-10-05", TODAY), [TODAY, "2026-10-05"]);
  assert.deepEqual(normalizeRange(undefined, undefined, TODAY), [TODAY, "2026-10-10"]);
  assert.deepEqual(normalizeRange(TODAY, "2027-12-31", TODAY), [TODAY, "2026-11-03"]);
});

test("kstToday: UTC 15시는 한국 다음 날", () => {
  assert.equal(kstToday(new Date("2026-10-03T15:30:00Z")), "2026-10-04");
});

test("searchFestivals: 진행·예정 축제만, 지역 필터, 출처·실데이터 표시", () => {
  const out = searchFestivals({ region: "Myeongdong" }, FEED, TODAY);
  assert.equal(out.source, FESTIVAL_SOURCE);
  assert.equal(out.is_sample, false);
  const ids = out.results.map((r) => r.id);
  assert.ok(ids.includes("a"));
  assert.ok(!ids.includes("b"), "지난 행사 제외");
  assert.ok(!ids.includes("c"), "다른 자치구 제외");
  assert.ok(!ids.includes("d"), "축제가 아닌 행사 제외(기본)");
  assert.ok(out.results.every((r) => r.source === FESTIVAL_SOURCE && r.is_sample === false));
});

test("searchFestivals: include_other_events, keyword", () => {
  assert.ok(searchFestivals({ include_other_events: true }, FEED, TODAY).results.some((r) => r.id === "d"));
  assert.deepEqual(searchFestivals({ keyword: "강남" }, FEED, TODAY).results.map((r) => r.id), ["c"]);
});

test("searchFestivals: 위험한 링크 제거, 잘못된 입력에도 안전", () => {
  const e = searchFestivals({}, FEED, TODAY).results.find((r) => r.id === "e");
  assert.equal(e.link, "");
  assert.doesNotThrow(() => searchFestivals(null, null, TODAY));
  assert.equal(searchFestivals("x", { events: "nope" }, TODAY).total_matches, 0);
});

test("loadFeed: HTTP 오류·형식 오류 거부", async () => {
  await assert.rejects(loadFeed("u", async () => ({ ok: false, status: 500 })));
  await assert.rejects(loadFeed("u", async () => ({ ok: true, json: async () => ({}) })));
  const f = await loadFeed("u", async () => ({ ok: true, json: async () => FEED }));
  assert.equal(f.events.length, FEED.events.length);
});

// 단독 호출: 실제 events.json(기존 모듈 산출물)
test("실데이터 단독 호출: 이번 주 서울 축제 / 중구 행사", () => {
  const path = fileURLToPath(new URL("../../data/events.json", import.meta.url));
  const feed = JSON.parse(readFileSync(path, "utf-8"));
  const today = kstToday();
  const fest = searchFestivals({}, feed, today);
  const jung = searchFestivals({ region: "Myeongdong", include_other_events: true }, feed, today);
  console.log(`  [실데이터 ${feed.updatedAt}] 오늘 ${today}: 7일 내 축제 ${fest.total_matches}건, 중구 행사 ${jung.total_matches}건`);
  for (const r of fest.results.slice(0, 3)) console.log(`   - ${r.start}~${r.end} ${r.title} (${r.district})`);
  assert.ok(fest.results.every((r) => r.end >= today && r.category.startsWith("축제")));
  assert.ok(jung.results.every((r) => r.district === "중구"));
});
