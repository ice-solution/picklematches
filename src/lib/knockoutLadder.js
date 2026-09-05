/**
 * 淘汰賽「畫鬼腳」分欄與對稱籤表（左右外圍 → 中央決賽）。
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
    [/十六|16強|\b16\b|r16|1\/8|八分/i, 22],
    [/八強|8強|quarter|1\/4|四分/i, 32],
    [/四強|4強|半決|準決|semi/i, 42],
    [/季軍|銅牌|third|三四名/i, 50],
    [/冠軍|決賽|final/i, 60],
    [/（未填輪次）/, 5],
  ];
  for (const [re, w] of tests) {
    if (re.test(s)) return w;
  }
  return 28;
}

function isFinalRound(label) {
  const s = String(label || '');
  // 「準決賽」含「決賽」二字，必須先排除
  if (/準決|半決|季軍|銅牌|third|三四名|八強|四強|十六|三十二|1\/[48]|R\d/i.test(s)) return false;
  return /冠軍|^決賽$|決賽|\bfinals?\b/i.test(s);
}

function isBronzeRound(label) {
  return /季軍|銅牌|third|三四名/i.test(label);
}

/** 前台欄位短標（對齊常見籤表用語） */
export function shortRoundLabel(label, matchCount) {
  if (isBronzeRound(label)) return '三、四名';
  if (isFinalRound(label)) return '決賽';
  if (/半決|準決|semi|四強/i.test(label)) return '半決賽';
  if (/八強|quarter|1\/4/i.test(label) || matchCount === 4) return '1/4';
  if (/十六|16強|1\/8|八分/i.test(label) || matchCount === 8) return '1/8';
  if (/三十二|32強/i.test(label) || matchCount === 16) return '1/16';
  return label;
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

/**
 * 前台對稱鬼腳資料：左右外圍輪次 + 中央決賽／季軍賽。
 * @returns {{
 *   rounds: Array<{ label: string, shortLabel: string, left: object[], right: object[] }>,
 *   final: object|null,
 *   bronze: object|null,
 * } | null}
 */
export function buildKnockoutBracket(matches) {
  const columns = buildKnockoutLadderColumns(matches);
  if (!columns.length) return null;

  let final = null;
  let bronze = null;
  const sideRounds = [];

  for (const col of columns) {
    if (isBronzeRound(col.label)) {
      bronze = col.matches[0] || null;
      continue;
    }
    if (isFinalRound(col.label)) {
      final = col.matches[0] || null;
      continue;
    }
    const half = Math.ceil(col.matches.length / 2);
    sideRounds.push({
      label: col.label,
      shortLabel: shortRoundLabel(col.label, col.matches.length),
      left: col.matches.slice(0, half),
      right: col.matches.slice(half),
      matchCount: col.matches.length,
    });
  }

  // 外圍（場次多）→ 內圈
  sideRounds.sort((a, b) => b.matchCount - a.matchCount);

  // 僅決賽／單場：仍顯示中央
  if (!sideRounds.length && !final && matches.length === 1) {
    final = matches[0];
  }

  return { rounds: sideRounds, final, bronze };
}

/** 籤表上顯示的隊名：占位／TBD 顯示「未產生」 */
export function bracketSlotLabel(team) {
  if (!team) return '未產生';
  const name = String(team.name || '').trim();
  if (!name) return '未產生';
  if (team.isPlaceholder) {
    if (/^BYE$/i.test(name)) return 'BYE';
    // 種子位如 A1、C2 可直接顯示
    if (/^[A-Za-z]\d{1,2}$/.test(name)) return name.toUpperCase();
    return '未產生';
  }
  if (/^(TBD|W-|L-)/i.test(name)) return '未產生';
  return name;
}
