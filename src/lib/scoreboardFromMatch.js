import { formatLabel } from './viewHelpers.js';

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

/** 賽程場次 status → 計分牌 status */
export function matchStatusToBoard(matchStatus) {
  if (matchStatus === 'live') return 'live';
  if (matchStatus === 'finished') return 'finished';
  return 'idle';
}

/**
 * 將 Match（需 populate teamA / teamB）轉為計分牌欄位
 * @param {object} match
 * @param {object|null} tournament
 */
export function scoreboardFieldsFromMatch(match, tournament = null) {
  const { gamesA, gamesB } = countGamesWon(match.completedGames);
  const subtitleParts = [];
  if (tournament?.name) subtitleParts.push(tournament.name);
  if (match.matchFormat) subtitleParts.push(formatLabel(match.matchFormat));

  return {
    teamAName: match.teamA?.name || '隊伍 A',
    teamBName: match.teamB?.name || '隊伍 B',
    scoreA: match.currentPoints?.a ?? 0,
    scoreB: match.currentPoints?.b ?? 0,
    gamesA,
    gamesB,
    court: match.court || '',
    roundLabel: match.round || '',
    subtitle: subtitleParts.join(' · '),
    status: matchStatusToBoard(match.status),
    isVisible: true,
    linkedMatchId: match._id,
    linkedMatchFormat: match.matchFormat || null,
  };
}
