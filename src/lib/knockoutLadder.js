/**
 * 淘汰賽「畫鬼腳」分欄：依 match.round 分組，外圍（場次多）在左、內圈在右。
 * 無簽表父子欄位時，僅能依輪次名稱與每輪場次數推斷顯示順序。
 */

function normalizeRoundLabel(round) {
  const s = round && String(round).trim();
  return s || '（未填輪次）';
}

/** 數字愈大愈像「內圈／決賽」；未辨識則置中 */
function roundOrderHint(label) {
  const s = label;
  const tests = [
    [/三十二|32強|\b32\b|r32/i, 12],
    [/十六|16強|\b16\b|r16/i, 22],
    [/八強|8強|quarter/i, 32],
    [/四強|4強|半決|準決|semi/i, 42],
    [/季軍|銅牌|third/i, 50],
    [/冠軍|決賽|final/i, 60],
    [/（未填輪次）/, 5],
  ];
  for (const [re, w] of tests) {
    if (re.test(s)) return w;
  }
  return 28;
}

/**
 * @param {Array<object>} matches — 已 populate teamA, teamB, winnerId（winnerId 可選）
 * @returns {Array<{ label: string, matches: object[] }>}
 */
export function buildKnockoutLadderColumns(matches) {
  if (!matches?.length) return [];

  const map = new Map();
  for (const m of matches) {
    const label = normalizeRoundLabel(m.round);
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(m);
  }

  for (const arr of map.values()) {
    arr.sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return String(a._id).localeCompare(String(b._id));
    });
  }

  const columns = [...map.entries()].map(([label, list]) => ({
    label,
    matches: list,
    count: list.length,
    hint: roundOrderHint(label),
  }));

  columns.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.hint !== b.hint) return a.hint - b.hint;
    return a.label.localeCompare(b.label, 'zh-Hant');
  });

  return columns.map(({ label, matches: ms }) => ({ label, matches: ms }));
}
