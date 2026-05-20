/** 依已完成局計算雙方贏局數 */
export function countGamesWon(completedGames) {
  let gamesA = 0;
  let gamesB = 0;
  for (const g of completedGames || []) {
    if (g.a > g.b) gamesA += 1;
    else if (g.b > g.a) gamesB += 1;
  }
  return { gamesA, gamesB };
}

/** 大會計分牌寫回時用的贏局摘要（非真實每局比分） */
export function isSummaryCompletedGame(g) {
  return (g.a === 15 && g.b === 0) || (g.a === 0 && g.b === 15);
}

/** 每局真實比分細項（略過計分牌寫回的 15-0 佔位） */
export function completedGamesDetail(completedGames) {
  if (!completedGames?.length) return '';
  const real = completedGames.filter((g) => !isSummaryCompletedGame(g));
  if (!real.length) return '';
  return real.map((g) => `${g.a}-${g.b}`).join(' · ');
}

/**
 * 比分顯示：main = 大比分贏局數（2-1），detail = 各局細分（15-12 · 10-15）
 */
export function scoreDisplayParts(m) {
  if (!m) return { main: '—', detail: '' };
  const ca = m.currentPoints?.a ?? 0;
  const cb = m.currentPoints?.b ?? 0;
  const completed = m.completedGames || [];
  const { gamesA, gamesB } = countGamesWon(completed);
  let detail = completedGamesDetail(completed);
  let main = '';

  if (completed.length) {
    main = `${gamesA}-${gamesB}`;
  }

  const live =
    m.status === 'live' || (m.status === 'scheduled' && (ca > 0 || cb > 0))
      ? `[${ca}-${cb}]`
      : '';

  if (live) {
    detail = detail ? `${detail} · ${live}` : live;
  }

  if (!main) {
    if (ca > 0 || cb > 0) main = `[${ca}-${cb}]`;
    else main = '—';
  }

  return { main, detail };
}

/** EJS helper：單行摘要（列表欄位用） */
export function scoreSummary(m) {
  const { main, detail } = scoreDisplayParts(m);
  if (detail) return `${main} · ${detail}`;
  return main;
}

/** 「大比分（贏局數）」區塊：大比分 + 括號細分 */
export function gamesLine(m) {
  const { main, detail } = scoreDisplayParts(m);
  if (main === '—' && !detail) return '—';
  if (!detail) return main;
  return `${main}（${detail}）`;
}

export function formatLabel(matchFormat) {
  const map = {
    bestOf5: '五局三勝',
    bestOf3: '三局兩勝',
    singleGame: '一局過',
  };
  return map[matchFormat] || matchFormat;
}
