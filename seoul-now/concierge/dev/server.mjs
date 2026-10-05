// 로컬 개발 서버: Worker 핸들러를 Node에서 실행. ANTHROPIC_API_KEY가 없으면 모의 모델 사용(답변에 표시됨).
// 축제 데이터는 기존 모듈 산출물(../data/events.json)을 로컬 파일로 읽는다.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { makeHandler } from "../src/worker.js";
import { createMockModel } from "./mock-model.mjs";

const PORT = Number(process.env.PORT || 8787);
const useMock = !process.env.ANTHROPIC_API_KEY;
const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, CLAUDE_MODEL: process.env.CLAUDE_MODEL,
  ALLOWED_ORIGIN: `http://localhost:${PORT}` };
const readData = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), "utf-8"));
// 로컬: 수집본(tour_food.json)이 비어 있으면 TOUR_FOOD_FIXTURE 경로의 시험 데이터를 쓴다. 상세 조회는 하지 않음.
const deps = {
  loadFeed: async () => readData("events.json"),
  loadTransit: (() => { let n = null; return async () => (n ||= readData("transit_network.json")); })(),
  loadTourFood: async () => (process.env.TOUR_FOOD_FIXTURE ? JSON.parse(readFileSync(process.env.TOUR_FOOD_FIXTURE, "utf-8")) : readData("tour_food.json")),
  fetchRestaurantDetail: async () => ({ ok: false, error: "detail_unavailable" }),
};
if (useMock) deps.createMessage = createMockModel();
const handler = makeHandler(deps);

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await handler(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, "127.0.0.1", () => console.log(`http://localhost:${PORT}  (${useMock ? "MOCK model" : "Claude API"})`));
