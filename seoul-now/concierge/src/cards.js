// 화면 카드 정리(중복 제거, 종류별 최대 개수). Worker·아티팩트 공용.
export const MAX_CARDS_PER_TYPE = 5;   // 휴대폰 화면에서 너무 길어지지 않게

export function dedupeCards(cards) {
  const seen = new Set();
  const perType = {};
  return cards.filter((c) => {
    const k = `${c.type}:${c.data && c.data.id}`;
    if (seen.has(k) || (perType[c.type] || 0) >= MAX_CARDS_PER_TYPE) return false;
    seen.add(k);
    perType[c.type] = (perType[c.type] || 0) + 1;
    return true;
  });
}
