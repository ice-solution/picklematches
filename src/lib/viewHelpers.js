/** EJS helper：顯示局分與目前局 */
export function scoreSummary(m) {
  if (!m) return '—';
  const segs = [];
  if (m.completedGames?.length) {
    m.completedGames.forEach((g) => segs.push(`${g.a}-${g.b}`));
  }
  const ca = m.currentPoints?.a ?? 0;
  const cb = m.currentPoints?.b ?? 0;
  if (m.status === 'live' || (m.status === 'scheduled' && (ca > 0 || cb > 0))) {
    segs.push(`[${ca}-${cb}]`);
  }
  if (!segs.length) return '0-0';
  return segs.join(' ');
}

export function gamesLine(m) {
  if (!m?.completedGames?.length) return '—';
  return m.completedGames.map((g) => `${g.a}-${g.b}`).join(' ｜ ');
}

export function formatLabel(matchFormat) {
  const map = {
    bestOf5: '五局三勝',
    bestOf3: '三局兩勝',
    singleGame: '一局過',
  };
  return map[matchFormat] || matchFormat;
}
