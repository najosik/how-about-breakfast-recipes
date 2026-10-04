// 로컬 개발·UI 시험용 모의 모델. 실제 Claude를 흉내 내 도구를 고르고, 도구 결과로 짧은 답을 만든다.
// 배포 번들에는 포함되지 않으며, 모든 답 앞에 "[개발용 모의 응답]"을 붙여 실제 답변과 혼동되지 않게 한다.
const has = (s, re) => re.test(s);

function pickTools(text) {
  const calls = [];
  const region = (text.match(/myeongdong|명동|明洞|홍대|hongdae|강남|gangnam|잠실|이태원|종로|인사동/i) || [""])[0];
  if (has(text, /사람|상담|직원|human|person|staff|真人|人工|スタッフ|분실|lost|丢|遺失|なくし/i)) return [["find_info_center", { area: region || text.slice(0, 40) }]];
  if (has(text, /eat|food|restaurant|맛집|음식|먹|食べ|グルメ|吃|美食/i)) calls.push(["search_places", { category: "food", region, time_of_day: has(text, /tonight|오늘 밤|저녁|今夜|今晚/i) ? "tonight" : undefined }]);
  if (has(text, /shop|쇼핑|ショッピング|购物|購物|買い物/i)) calls.push(["search_places", { category: "shopping", region }]);
  if (has(text, /night market|야시장|ナイトマーケット|夜市/i)) calls.push(["get_transit_guide", { origin: region || "명동", destination: "광장시장" }]);
  if (has(text, /festival|축제|祭|节|節|event|행사/i)) calls.push(["search_festivals", { region }]);
  const days = (text.match(/(\d+)\s*(일|days?|日|天)/) || [])[1];
  if (has(text, /궁|palace|宮|宫|전망대|observatory|展望|패스|pass/i)) {
    const interests = [];
    if (has(text, /궁|palace|宮|宫/i)) interests.push("palace");
    if (has(text, /전망대|observatory|展望/i)) interests.push("observatory");
    calls.push(["recommend_dsp", { days: Number(days) || 2, interests }]);
  }
  return calls;
}

export function createMockModel() {
  let n = 0;
  return async (params) => {
    const msgs = params.messages;
    const last = msgs[msgs.length - 1];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user" && typeof m.content === "string");
    const toolResultsPending = last.role === "user" && Array.isArray(last.content);
    if (!toolResultsPending && params.tool_choice?.type !== "none") {
      const calls = pickTools(lastUser ? lastUser.content : "");
      if (calls.length) {
        return { stop_reason: "tool_use", content: calls.map(([name, input]) => ({ type: "tool_use", id: `mock_${++n}`, name, input })) };
      }
    }
    const results = toolResultsPending ? last.content.map((r) => { try { return JSON.parse(r.content); } catch { return {}; } }) : [];
    const lines = ["[개발용 모의 응답 · mock reply, not Claude]"];
    for (const r of results) {
      const items = r.results || (r.guide ? [r.guide] : []);
      const label = r.is_sample === false ? "[서울시 문화행사 정보 API]" : "[샘플 데이터]";
      for (const it of items.slice(0, 3)) {
        const name = it.title || (it.name && (it.name.en || it.name.ko || it.name)) || (it.from ? `${it.from} → ${it.to}` : "");
        lines.push(`- **${name}** ${label}`);
      }
    }
    if (results.length === 0) lines.push("I can help with food, shopping, transport, festivals and passes in Seoul.");
    return { stop_reason: "end_turn", content: [{ type: "text", text: lines.join("\n") }] };
  };
}
