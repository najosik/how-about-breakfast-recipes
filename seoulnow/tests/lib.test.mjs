// node --test seoulnow/tests
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../lib.js";

const ev = (o) => ({ id: "abc123", title: "행사", category: "콘서트", district: "마포구", start: "2026-11-10", end: "2026-11-10", ...o });
const TODAY = "2026-11-10";   // 화요일

test("오늘 날짜는 서울 시간", () => {
  assert.equal(L.kstToday(new Date("2026-11-09T15:30:00Z")), "2026-11-10");
});

test("기간: 오늘·이번 주말(금~일)·이번 달·전체", () => {
  assert.deepEqual(L.periodRange("today", TODAY), [TODAY, TODAY]);
  assert.deepEqual(L.periodRange("weekend", TODAY), ["2026-11-13", "2026-11-15"]);
  assert.deepEqual(L.periodRange("weekend", "2026-11-14"), ["2026-11-14", "2026-11-15"]);   // 토요일이면 오늘~일
  assert.deepEqual(L.periodRange("weekend", "2026-11-15"), ["2026-11-15", "2026-11-15"]);
  assert.deepEqual(L.periodRange("month", TODAY), [TODAY, "2026-11-30"]);
  assert.equal(L.periodRange("all", TODAY)[1], "9999-12-31");
});

test("월 목록: 오늘부터 12개월, 연도 넘김", () => {
  const m = L.monthsAhead(TODAY, 12);
  assert.equal(m.length, 12);
  assert.deepEqual([m[0], m[1], m[2], m[11]], ["2026-11", "2026-12", "2027-01", "2027-10"]);
  assert.deepEqual(L.monthRange("2026-11", TODAY), [TODAY, "2026-11-30"]);
  assert.deepEqual(L.monthRange("2027-02", TODAY), ["2027-02-01", "2027-02-28"]);
});

test("주소 검증: 허용 목록 밖 값은 버리고 기본값", () => {
  const s = L.parseQuery("?lang=xx&period=<script>&month=2030-01&gu=mapo,evil,mapo&genre=perf,x&sort=pop&event=../../etc", TODAY);
  assert.deepEqual(s, { lang: "ko", period: "month", month: null, gu: ["mapo"], genre: ["perf"], sort: "date", ended: false, event: null });
  const m = L.parseQuery("?month=2027-01&period=today", TODAY);
  assert.equal(m.month, "2027-01");
  assert.equal(m.period, "all");   // 월을 고르면 기간 탭은 전체
  assert.equal(L.parseQuery("?event=5cb92ddb61b0&lang=en", TODAY).event, "5cb92ddb61b0");
});

test("주소 만들기: 기본값 생략, 공유 주소에는 행사 ID만", () => {
  const s = L.parseQuery("", TODAY);
  assert.equal(L.toQuery(s), "");
  assert.equal(L.toQuery({ ...s, gu: ["mapo", "jongno"], genre: ["perf"], period: "all", month: "2027-01" }), "?period=all&month=2027-01&gu=mapo%2Cjongno&genre=perf");
  assert.equal(L.toQuery({ ...s, gu: ["mapo"], event: "abc123", lang: "en" }), "?lang=en&event=abc123");
  assert.deepEqual(L.normalizeState({ ...s, period: "all", month: "2026-11" }, TODAY), { ...s, period: "month", month: null });
});

test("필터: 기간·자치구·장르, 건수용 조건 빼기, 종료 행사 숨김", () => {
  const events = [ev({ id: "a1", start: "2026-11-01", end: "2026-11-30" }), ev({ id: "a2", district: "종로구", category: "전시/미술", start: "2026-12-05", end: "2026-12-06" }),
    ev({ id: "a3", category: "축제-문화/예술", start: "2026-11-14", end: "2026-11-14" }), ev({ id: "a4", start: "2026-11-01", end: "2026-11-09" })];
  const s = L.parseQuery("", TODAY);
  assert.deepEqual(L.filterEvents(events, s, TODAY).map((e) => e.id), ["a1", "a3"]);
  assert.deepEqual(L.filterEvents(events, { ...s, period: "weekend" }, TODAY).map((e) => e.id), ["a1", "a3"]);
  assert.deepEqual(L.filterEvents(events, { ...s, period: "all", gu: ["jongno"] }, TODAY).map((e) => e.id), ["a2"]);
  assert.deepEqual(L.filterEvents(events, { ...s, genre: ["festival"] }, TODAY).map((e) => e.id), ["a3"]);
  assert.equal(L.filterEvents(events, { ...s, genre: ["festival"] }, TODAY, ["genre"]).length, 2);
  assert.ok(L.filterEvents(events, { ...s, ended: true }, TODAY).some((e) => e.id === "a4"));
});

test("정렬: 날짜순(진행 중 먼저)·마감 임박순·최신 등록순", () => {
  const list = [ev({ id: "x", title: "나", start: "2026-11-20", end: "2026-11-21", registered: "2026-11-01" }),
    ev({ id: "y", title: "가", start: "2026-11-01", end: "2026-12-31", registered: "2026-10-01" }),
    ev({ id: "z", title: "다", start: "2026-11-05", end: "2026-11-12", registered: "2026-11-05" })];
  assert.deepEqual(L.sortEvents(list, "date", TODAY).map((e) => e.id), ["y", "z", "x"]);
  assert.deepEqual(L.sortEvents(list, "ending", TODAY).map((e) => e.id), ["z", "x", "y"]);
  assert.deepEqual(L.sortEvents(list, "recent", TODAY).map((e) => e.id), ["z", "x", "y"]);
});

test("상태 배지", () => {
  assert.deepEqual(L.statusOf(ev({ start: "2026-11-01", end: "2026-11-30" }), TODAY), { key: "ongoing" });
  assert.deepEqual(L.statusOf(ev({ start: "2026-11-01", end: "2026-11-12" }), TODAY), { key: "closing", days: 2 });
  assert.deepEqual(L.statusOf(ev({ start: "2026-11-13", end: "2026-11-14" }), TODAY), { key: "dday", days: 3 });
  assert.deepEqual(L.statusOf(ev({ start: "2026-11-01", end: "2026-11-09" }), TODAY), { key: "ended" });
});

test("날짜 표기: 같은 해면 끝 연도 생략", () => {
  assert.equal(L.formatRange("2026-11-07", "2026-11-30"), "2026.11.07(토) – 11.30(월)");
  assert.equal(L.formatRange("2026-12-31", "2027-01-02"), "2026.12.31(목) – 2027.01.02(토)");
  assert.equal(L.formatRange("2026-11-10", "2026-11-10", "en"), "2026.11.10(Tue)");
});

test("장르 판별", () => {
  assert.equal(L.genreOf("클래식"), "perf");
  assert.equal(L.genreOf("축제-전통/역사"), "festival");
  assert.equal(L.genreOf("교육/체험"), "edu");
  assert.equal(L.genreOf("무엇"), "other");
});

test(".ics: 종일 일정, 이스케이프", () => {
  const ics = L.toIcs(ev({ title: "A, B; C\nD", start: "2026-11-07", end: "2026-11-30", place: "문화비축기지" }), "https://x/?event=abc123", new Date("2026-11-10T00:00:00Z"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261107\r\n"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20261201\r\n"));
  assert.ok(ics.includes("SUMMARY:A\\, B\; C\\nD\r\n"));
  assert.ok(ics.includes("LOCATION:마포구 문화비축기지"));
});

test("링크는 http·https만", () => {
  assert.equal(L.safeUrl("javascript:alert(1)"), "");
  assert.equal(L.safeUrl("https://a.b/c"), "https://a.b/c");
});
