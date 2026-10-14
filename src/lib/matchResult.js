import { Match } from '../models/Match.js';
import { isLeagueFormat, leagueWinnerId, leagueGameLabel, lineupPair } from './leagueRules.js';
import { resolveCurrentPlayers } from './leagueLineup.js';
import { playersFromConfirmedLineup } from './leagueLineup.js';

/**
 * 從 winnerId、已完成局或目前局分推斷勝方（供報分表與寫回賽程）
 * @returns {string|null} team ObjectId string
 */
export function inferMatchWinnerId(match) {
  if (!match) return null;

  const teamA = match.teamA?._id ? String(match.teamA._id) : String(match.teamA || '');
  const teamB = match.teamB?._id ? String(match.teamB._id) : String(match.teamB || '');
  if (!teamA || !teamB) return null;

  if (match.winnerId) {
    const w = String(match.winnerId);
    if (w === teamA || w === teamB) return w;
  }

  if (isLeagueFormat(match.matchFormat)) {
    return leagueWinnerId(match);
  }

  const games = Array.isArray(match.completedGames) ? match.completedGames : [];
  let gamesWonA = 0;
  let gamesWonB = 0;
  let ptsA = 0;
  let ptsB = 0;
  for (const g of games) {
    const a = Number(g?.a ?? 0);
    const b = Number(g?.b ?? 0);
    ptsA += a;
    ptsB += b;
    if (a > b) gamesWonA += 1;
    else if (b > a) gamesWonB += 1;
  }

  if (gamesWonA > gamesWonB) return teamA;
  if (gamesWonB > gamesWonA) return teamB;
  if (ptsA > ptsB) return teamA;
  if (ptsB > ptsA) return teamB;

  const ca = Number(match.currentPoints?.a ?? 0);
  const cb = Number(match.currentPoints?.b ?? 0);
  if (ca > cb) return teamA;
  if (cb > ca) return teamB;

  return null;
}

/** 累計場內得分（已完成局；完賽後通常已併入 completedGames） */
export function matchPointsTotals(match) {
  let ptsA = 0;
  let ptsB = 0;
  for (const g of match.completedGames || []) {
    ptsA += Number(g?.a ?? 0);
    ptsB += Number(g?.b ?? 0);
  }
  if (match.status === 'live') {
    ptsA += Number(match.currentPoints?.a ?? 0);
    ptsB += Number(match.currentPoints?.b ?? 0);
  }
  return { ptsA, ptsB };
}

/** 完賽時把目前局分併入 completedGames（若尚未記錄） */
export function ensureCompletedGamesFromCurrent(match) {
  const ca = Number(match.currentPoints?.a ?? 0);
  const cb = Number(match.currentPoints?.b ?? 0);
  if (ca === 0 && cb === 0) return;

  const completed = Array.isArray(match.completedGames) ? [...match.completedGames] : [];
  const label = isLeagueFormat(match.matchFormat) ? leagueGameLabel(completed.length) : '';
  const lineup = isLeagueFormat(match.matchFormat)
    ? resolveCurrentPlayers(match)
    : { playersA: [], playersB: [] };
  const row = {
    a: ca,
    b: cb,
    ...(label ? { label } : {}),
    ...(lineup.playersA.length ? { playersA: lineup.playersA } : {}),
    ...(lineup.playersB.length ? { playersB: lineup.playersB } : {}),
  };
  if (completed.length === 0) {
    match.completedGames = [row];
    match.currentGameIndex = 1;
    return;
  }

  const last = completed[completed.length - 1];
  if (last && last.a === ca && last.b === cb) return;

  match.completedGames = completed;
  match.completedGames.push(row);
  match.currentGameIndex = match.completedGames.length;
}

/**
 * 標記完賽：依比分自動判勝方（局數優先，否則總分高者勝）並寫入資料庫欄位
 * @returns {{ ok: boolean, winnerId?: string|null, tied?: boolean }}
 */
export function finalizeFinishedMatch(match) {
  if (!match) return { ok: false };

  match.status = 'finished';
  ensureCompletedGamesFromCurrent(match);

  const winner = inferMatchWinnerId({
    teamA: match.teamA,
    teamB: match.teamB,
    completedGames: match.completedGames,
    currentPoints: match.currentPoints,
    status: 'finished',
  });

  if (winner) {
    match.winnerId = winner;
    match.currentPoints = { a: 0, b: 0 };
    if (typeof match.markModified === 'function') {
      match.markModified('completedGames');
      match.markModified('currentPoints');
      match.markModified('winnerId');
    }
    return { ok: true, winnerId: winner };
  }

  match.winnerId = null;
  return { ok: true, winnerId: null, tied: true };
}

/** 後台表單手動輸入比分（completedGameA[] / completedGameB[]、出場、備註） */
export function applyManualScoresFromBody(match, body) {
  if (!match || !body) return;

  const parseNonNeg = (v) => {
    const n = parseInt(String(v ?? '').trim(), 10);
    return Number.isNaN(n) || n < 0 ? 0 : n;
  };
  const asArr = (v) => {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
  };

  let as = body.completedGameA;
  let bs = body.completedGameB;
  const pA1 = asArr(body.gameAPlayer1);
  const pA2 = asArr(body.gameAPlayer2);
  const pB1 = asArr(body.gameBPlayer1);
  const pB2 = asArr(body.gameBPlayer2);
  const remarks = asArr(body.gameRemark);
  const hasLineupFields =
    pA1.length || pA2.length || pB1.length || pB2.length || remarks.length ||
    body.currentAPlayer1 !== undefined ||
    body.currentAPlayer2 !== undefined ||
    body.currentBPlayer1 !== undefined ||
    body.currentBPlayer2 !== undefined;

  if (as === undefined && bs === undefined && !hasLineupFields) return;

  if (!Array.isArray(as)) as = as != null && String(as).trim() !== '' ? [as] : [];
  if (!Array.isArray(bs)) bs = bs != null && String(bs).trim() !== '' ? [bs] : [];

  const games = [];
  const len = Math.max(as.length, bs.length, pA1.length, pA2.length, pB1.length, pB2.length, remarks.length);
  for (let i = 0; i < len; i++) {
    const aRaw = as[i];
    const bRaw = bs[i];
    const playersA = lineupPair(pA1[i], pA2[i]);
    const playersB = lineupPair(pB1[i], pB2[i]);
    const remark = String(remarks[i] ?? '').trim().slice(0, 200);
    const hasScore =
      String(aRaw ?? '').trim() !== '' ||
      String(bRaw ?? '').trim() !== '' ||
      parseNonNeg(aRaw) > 0 ||
      parseNonNeg(bRaw) > 0;
    if (!hasScore && !playersA.length && !playersB.length && !remark) continue;
    const row = {
      a: parseNonNeg(aRaw),
      b: parseNonNeg(bRaw),
      playersA,
      playersB,
      remark,
    };
    if (isLeagueFormat(match.matchFormat)) row.label = leagueGameLabel(games.length);
    games.push(row);
  }

  const curA = parseNonNeg(body.currentPointA);
  const curB = parseNonNeg(body.currentPointB);
  const hasCurrent = curA > 0 || curB > 0;
  if (!games.length && !hasCurrent && !hasLineupFields) return;

  if (games.length) {
    match.completedGames = games;
    match.currentGameIndex = games.length;
  }
  match.currentPoints = { a: curA, b: curB };
  if (isLeagueFormat(match.matchFormat)) {
    match.currentLineup = {
      playersA: lineupPair(body.currentAPlayer1, body.currentAPlayer2),
      playersB: lineupPair(body.currentBPlayer1, body.currentBPlayer2),
    };
  }

  if (typeof match.markModified === 'function') {
    match.markModified('completedGames');
    match.markModified('currentPoints');
    match.markModified('currentLineup');
  }
}

/**
 * 修正賽事內所有已完賽但未正確記錄勝負的場次。
 * 僅供後台手動維護；勿在 GET／前台載入時呼叫（與即時改分並發會觸發 VersionError）。
 */
export async function repairFinishedMatchesForTournament(tournamentId) {
  const ids = await Match.find({ tournamentId, status: 'finished' }).select('_id').lean();
  let repaired = 0;
  for (const { _id } of ids) {
    const saved = await repairOneFinishedMatch(_id);
    if (saved) repaired += 1;
  }
  return repaired;
}

/** 單場完賽修正；遇樂觀鎖衝突時重試（後台改分與 repair 同時進行） */
export async function repairOneFinishedMatch(matchId, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const match = await Match.findById(matchId);
    if (!match || match.status !== 'finished') return false;

    const before = match.winnerId ? String(match.winnerId) : '';
    finalizeFinishedMatch(match);
    const after = match.winnerId ? String(match.winnerId) : '';
    if (after === before && !match.isModified()) return false;

    try {
      await match.save();
      return true;
    } catch (err) {
      if (err?.name === 'VersionError' && attempt < maxAttempts - 1) continue;
      throw err;
    }
  }
  return false;
}
