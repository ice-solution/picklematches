import { countGamesWon, formatLabel } from './viewHelpers.js';

export { countGamesWon };

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

  const recordedGames = (match.completedGames || [])
    .filter((g) => g && (g.a > 0 || g.b > 0))
    .map((g) => ({ a: g.a ?? 0, b: g.b ?? 0 }));

  return {
    teamAName: match.teamA?.name || '隊伍 A',
    teamBName: match.teamB?.name || '隊伍 B',
    scoreA: match.currentPoints?.a ?? 0,
    scoreB: match.currentPoints?.b ?? 0,
    gamesA,
    gamesB,
    recordedGames,
    court: match.court || '',
    roundLabel: match.round || '',
    subtitle: subtitleParts.join(' · '),
    status: matchStatusToBoard(match.status),
    isVisible: true,
    linkedMatchId: match._id,
    linkedMatchFormat: match.matchFormat || null,
    servingSide: 'a',
  };
}
