import { MATCH_FORMAT } from '../models/Match.js';
import { finalizeFinishedMatch } from './matchResult.js';

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

/** 提示用：至少 15 分且領先 2（不再自動換局／完賽） */
function isGameComplete(scoreA, scoreB) {
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
  match.currentPoints[side] = next;

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
    gameReady: isGameComplete(a, b),
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
  if (a === b) {
    return { ok: false, error: 'tied_game' };
  }

  match.completedGames.push({ a, b });
  match.currentGameIndex = match.completedGames.length;
  match.currentPoints = { a: 0, b: 0 };
  match.serving = '';
  if (match.status === 'scheduled') match.status = 'live';
  if (typeof match.markModified === 'function') {
    match.markModified('completedGames');
    match.markModified('currentPoints');
  }

  const gamesWonA = match.completedGames.filter((g) => g.a > g.b).length;
  const gamesWonB = match.completedGames.filter((g) => g.b > g.a).length;
  const need = gamesNeededToWinMatch(match.matchFormat);
  const canFinish = gamesWonA >= need || gamesWonB >= need;

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

export function isGameReadyToCommit(scoreA, scoreB) {
  return isGameComplete(scoreA, scoreB);
}
