import { Match, MATCH_FORMAT } from '../models/Match.js';
import { finalizeFinishedMatch } from './matchResult.js';
import {
  isLeagueFormat,
  isLeagueGameComplete,
  leagueGameLabel,
  LEAGUE_GAME_COUNT,
  LEAGUE_POINTS_TO_WIN_GAME,
  lineupFromCurrent,
} from './leagueRules.js';
import { playersFromConfirmedLineup, resolveCurrentPlayers } from './leagueLineup.js';

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

/** 提示用：至少 15 分且領先 2（不再自動換局／完賽）；聯賽回合先到 21 */
function isGameComplete(scoreA, scoreB, matchFormat) {
  if (isLeagueFormat(matchFormat)) return isLeagueGameComplete(scoreA, scoreB);
  const hi = Math.max(scoreA, scoreB);
  const lo = Math.min(scoreA, scoreB);
  if (hi < 15) return false;
  return hi - lo >= 2;
}

function ensureMatchScoringState(match) {
  if (!Array.isArray(match.completedGames)) match.completedGames = [];
  if (!match.currentPoints || typeof match.currentPoints !== 'object') {
    match.currentPoints = { a: 0, b: 0 };
  }
  if (match.currentPoints.a == null) match.currentPoints.a = 0;
  if (match.currentPoints.b == null) match.currentPoints.b = 0;
  if (match.currentGameIndex == null) match.currentGameIndex = match.completedGames.length;
}

/**
 * 調整目前局分數（+1 / -1），不自動換局或完賽。
 */
export function adjustCurrentPoints(match, side, delta) {
  if (match.status === 'finished' || match.status === 'cancelled') {
    return { ok: false, error: 'match_ended' };
  }
  if (side !== 'a' && side !== 'b') {
    return { ok: false, error: 'invalid_side' };
  }
  const d = Number(delta);
  if (d !== 1 && d !== -1) {
    return { ok: false, error: 'invalid_delta' };
  }

  ensureMatchScoringState(match);
  const next = Math.max(0, Number(match.currentPoints[side] || 0) + d);
  const cap = isLeagueFormat(match.matchFormat) ? LEAGUE_POINTS_TO_WIN_GAME : null;
  match.currentPoints[side] = cap == null ? next : Math.min(next, cap);

  // 得分後自動換成該隊發球（同 ranking control）
  if (d === 1) {
    match.serving = side;
  }

  if (
    match.status === 'scheduled' &&
    (match.currentPoints.a > 0 || match.currentPoints.b > 0)
  ) {
    match.status = 'live';
  }

  const a = match.currentPoints.a;
  const b = match.currentPoints.b;
  return {
    ok: true,
    gameReady: isGameComplete(a, b, match.matchFormat),
    gameEnded: false,
    matchEnded: false,
  };
}

/** @deprecated 相容舊呼叫：等同 +1，不再自動換局 */
export function addPointToCurrentGame(match, side) {
  return adjustCurrentPoints(match, side, 1);
}

/**
 * 手動結束目前局並進入下一局（場地登入者控制）
 */
export function commitCurrentGame(match) {
  if (match.status === 'finished' || match.status === 'cancelled') {
    return { ok: false, error: 'match_ended' };
  }
  ensureMatchScoringState(match);
  const a = Number(match.currentPoints.a || 0);
  const b = Number(match.currentPoints.b || 0);
  if (a === 0 && b === 0) {
    return { ok: false, error: 'empty_game' };
  }
  if (isLeagueFormat(match.matchFormat)) {
    if (match.completedGames.length >= LEAGUE_GAME_COUNT) {
      return { ok: false, error: 'league_games_complete' };
    }
    if (!isLeagueGameComplete(a, b)) {
      return { ok: false, error: 'league_game_not_to_21' };
    }
  } else if (a === b) {
    return { ok: false, error: 'tied_game' };
  }

  const label = isLeagueFormat(match.matchFormat) ? leagueGameLabel(match.completedGames.length) : '';
  const fromCurrent = isLeagueFormat(match.matchFormat) ? lineupFromCurrent(match) : { playersA: [], playersB: [] };
  const fromBoard = isLeagueFormat(match.matchFormat)
    ? playersFromConfirmedLineup(match, match.completedGames.length)
    : { playersA: [], playersB: [] };
  const lineup = {
    playersA: fromCurrent.playersA.length ? fromCurrent.playersA : fromBoard.playersA,
    playersB: fromCurrent.playersB.length ? fromCurrent.playersB : fromBoard.playersB,
  };
  const row = { a, b };
  if (label) row.label = label;
  if (lineup.playersA.length) row.playersA = lineup.playersA;
  if (lineup.playersB.length) row.playersB = lineup.playersB;
  match.completedGames.push(row);
  match.currentGameIndex = match.completedGames.length;
  match.currentPoints = { a: 0, b: 0 };
  match.serving = '';
  if (isLeagueFormat(match.matchFormat)) {
    const next = playersFromConfirmedLineup(match, match.completedGames.length);
    match.currentLineup = { playersA: next.playersA, playersB: next.playersB };
  }
  if (match.status === 'scheduled') match.status = 'live';
  if (typeof match.markModified === 'function') {
    match.markModified('completedGames');
    match.markModified('currentPoints');
    match.markModified('currentLineup');
  }

  const gamesWonA = match.completedGames.filter((g) => g.a > g.b).length;
  const gamesWonB = match.completedGames.filter((g) => g.b > g.a).length;
  const need = gamesNeededToWinMatch(match.matchFormat);
  const canFinish = isLeagueFormat(match.matchFormat)
    ? match.completedGames.length >= LEAGUE_GAME_COUNT
    : gamesWonA >= need || gamesWonB >= need;

  return { ok: true, gameEnded: true, canFinish, matchEnded: false };
}

/**
 * 手動完賽（場地登入者）
 */
export function finishMatchManual(match) {
  if (match.status === 'cancelled') {
    return { ok: false, error: 'match_cancelled' };
  }
  ensureMatchScoringState(match);
  if (isLeagueFormat(match.matchFormat)) {
    const ca = Number(match.currentPoints.a || 0);
    const cb = Number(match.currentPoints.b || 0);
    const games = [...(match.completedGames || [])];
    if (ca > 0 || cb > 0) {
      if (!isLeagueGameComplete(ca, cb) && games.length < LEAGUE_GAME_COUNT) {
        return { ok: false, error: 'league_game_not_to_21' };
      }
      const resolved = resolveCurrentPlayers(match);
      games.push({
        a: ca,
        b: cb,
        label: leagueGameLabel(games.length),
        playersA: resolved.playersA,
        playersB: resolved.playersB,
      });
      match.completedGames = games;
      match.currentPoints = { a: 0, b: 0 };
      if (typeof match.markModified === 'function') {
        match.markModified('completedGames');
        match.markModified('currentPoints');
      }
    }
    if (games.length < LEAGUE_GAME_COUNT) {
      return { ok: false, error: 'league_need_five' };
    }
    const ptsA = games.reduce((s, g) => s + Number(g.a || 0), 0);
    const ptsB = games.reduce((s, g) => s + Number(g.b || 0), 0);
    if (ptsA === ptsB) {
      return { ok: false, error: 'league_tied' };
    }
  }
  const result = finalizeFinishedMatch(match);
  match.serving = '';
  return { ok: true, ...result, matchEnded: true };
}

/** 手動設定發球方 */
export function setServingSide(match, side) {
  if (match.status === 'finished' || match.status === 'cancelled') {
    return { ok: false, error: 'match_ended' };
  }
  if (side !== 'a' && side !== 'b') {
    return { ok: false, error: 'invalid_side' };
  }
  match.serving = side;
  if (match.status === 'scheduled') match.status = 'live';
  return { ok: true };
}

export function isDeuce(scoreA, scoreB) {
  return scoreA >= 14 && scoreB >= 14 && scoreA === scoreB;
}

export function isGameReadyToCommit(scoreA, scoreB, matchFormat) {
  return isGameComplete(scoreA, scoreB, matchFormat);
}
