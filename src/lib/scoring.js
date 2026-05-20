import { MATCH_FORMAT } from '../models/Match.js';

export function gamesNeededToWinMatch(matchFormat) {
  switch (matchFormat) {
    case MATCH_FORMAT.SINGLE_GAME:
      return 1;
    case MATCH_FORMAT.BEST_OF_3:
      return 2;
    case MATCH_FORMAT.BEST_OF_5:
      return 3;
    default:
      return 2;
  }
}

/** 15 分制：至少 15 分且領先 2 分（含 Deuce 後無上限） */
function isGameComplete(scoreA, scoreB) {
  const hi = Math.max(scoreA, scoreB);
  const lo = Math.min(scoreA, scoreB);
  if (hi < 15) return false;
  return hi - lo >= 2;
}

/**
 * 為目前局加一分。會直接修改 match 文件（Mongoose document）。
 * @returns {{ ok: true, gameEnded?: boolean, matchEnded?: boolean } | { ok: false, error: string }}
 */
export function addPointToCurrentGame(match, side) {
  if (match.status === 'finished' || match.status === 'cancelled') {
    return { ok: false, error: 'match_ended' };
  }
  if (side !== 'a' && side !== 'b') {
    return { ok: false, error: 'invalid_side' };
  }

  match.currentPoints[side] += 1;
  if (match.status === 'scheduled') match.status = 'live';

  const a = match.currentPoints.a;
  const b = match.currentPoints.b;

  if (!isGameComplete(a, b)) {
    return { ok: true, gameEnded: false, matchEnded: false };
  }

  match.completedGames.push({ a, b });
  const gamesWonA = match.completedGames.filter((g) => g.a > g.b).length;
  const gamesWonB = match.completedGames.filter((g) => g.b > g.a).length;
  const need = gamesNeededToWinMatch(match.matchFormat);

  if (gamesWonA >= need || gamesWonB >= need) {
    match.status = 'finished';
    match.winnerId = gamesWonA > gamesWonB ? match.teamA : match.teamB;
    match.currentPoints = { a: 0, b: 0 };
    return { ok: true, gameEnded: true, matchEnded: true };
  }

  match.currentGameIndex += 1;
  match.currentPoints = { a: 0, b: 0 };
  return { ok: true, gameEnded: true, matchEnded: false };
}

export function isDeuce(scoreA, scoreB) {
  return scoreA >= 14 && scoreB >= 14 && scoreA === scoreB;
}
