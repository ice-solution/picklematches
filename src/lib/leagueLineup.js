import crypto from 'crypto';
import {
  LEAGUE_GAME_COUNT,
  LEAGUE_GAME_LABELS,
  leagueGameLabel,
  normalizeLineupNames,
  rosterFromTeam,
  lineupFromCurrent,
} from './leagueRules.js';

export function emptyLineupGames() {
  return Array.from({ length: LEAGUE_GAME_COUNT }, () => ({ players: [] }));
}

export function newLineupToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function normalizeSide(side) {
  return side === 'b' || side === 'B' ? 'b' : side === 'a' || side === 'A' ? 'a' : '';
}

export function getSideLineup(match, side) {
  const s = normalizeSide(side);
  if (!s) return null;
  const block = match?.lineupBySide?.[s] || {};
  const games = Array.isArray(block.games) ? block.games : [];
  const padded = emptyLineupGames().map((slot, i) => ({
    players: normalizeLineupNames(games[i]?.players).slice(0, 2),
    label: leagueGameLabel(i),
  }));
  return {
    side: s,
    token: String(block.token || ''),
    confirmed: !!block.confirmed,
    confirmedAt: block.confirmedAt || null,
    games: padded,
  };
}

/** 確保雙方都有 token；回傳是否改過 */
export function ensureLineupTokens(match) {
  if (!match.lineupBySide || typeof match.lineupBySide !== 'object') {
    match.lineupBySide = { a: {}, b: {} };
  }
  if (!match.lineupBySide.a) match.lineupBySide.a = {};
  if (!match.lineupBySide.b) match.lineupBySide.b = {};
  let changed = false;
  for (const s of ['a', 'b']) {
    if (!match.lineupBySide[s].token) {
      match.lineupBySide[s].token = newLineupToken();
      changed = true;
    }
    if (!Array.isArray(match.lineupBySide[s].games) || match.lineupBySide[s].games.length < LEAGUE_GAME_COUNT) {
      const prev = Array.isArray(match.lineupBySide[s].games) ? match.lineupBySide[s].games : [];
      match.lineupBySide[s].games = emptyLineupGames().map((slot, i) => ({
        players: normalizeLineupNames(prev[i]?.players).slice(0, 2),
      }));
      changed = true;
    }
  }
  if (changed && typeof match.markModified === 'function') {
    match.markModified('lineupBySide');
  }
  return changed;
}

/** 每位選手同一場對戰最多可排入幾個回合 */
export const MAX_PLAYER_APPEARANCES = 2;

export function countPlayerAppearances(games) {
  const m = new Map();
  for (const g of games || []) {
    for (const n of normalizeLineupNames(g?.players)) {
      m.set(n, (m.get(n) || 0) + 1);
    }
  }
  return m;
}

export function validateAppearanceLimit(games, max = MAX_PLAYER_APPEARANCES) {
  const m = countPlayerAppearances(games);
  for (const [player, count] of m) {
    if (count > max) {
      return { ok: false, error: 'player_overused', player, count, max };
    }
  }
  return { ok: true };
}

export function parseLineupGamesPayload(rawGames, roster) {
  const allowed = new Set((roster || []).map((n) => String(n).trim()).filter(Boolean));
  const games = emptyLineupGames();
  const list = Array.isArray(rawGames) ? rawGames : [];
  const appear = new Map();
  for (let i = 0; i < LEAGUE_GAME_COUNT; i++) {
    const names = normalizeLineupNames(list[i]?.players ?? list[i]).slice(0, 2);
    const filtered = names.filter((n) => allowed.has(n));
    // 同一回合唔重複；跨回合最多 MAX_PLAYER_APPEARANCES 次
    const uniq = [];
    for (const n of filtered) {
      if (uniq.includes(n)) continue;
      if ((appear.get(n) || 0) >= MAX_PLAYER_APPEARANCES) continue;
      uniq.push(n);
      appear.set(n, (appear.get(n) || 0) + 1);
    }
    games[i] = { players: uniq.slice(0, 2) };
  }
  return games;
}

export function validateLineupComplete(games) {
  if (!Array.isArray(games) || games.length < LEAGUE_GAME_COUNT) {
    return { ok: false, error: 'need_five_slots' };
  }
  for (let i = 0; i < LEAGUE_GAME_COUNT; i++) {
    const p = normalizeLineupNames(games[i]?.players);
    if (p.length < 2) {
      return { ok: false, error: 'slot_incomplete', slot: i, label: LEAGUE_GAME_LABELS[i] };
    }
  }
  const limit = validateAppearanceLimit(games);
  if (!limit.ok) return limit;
  return { ok: true };
}

/** 若已有 completedGames 列，把確認排陣寫入該邊 players（唔會為咗排陣而造 0-0 佔位局） */
export function syncLineupToCompletedGames(match, side) {
  const s = normalizeSide(side);
  if (!s) return;
  const lineup = getSideLineup(match, s);
  if (!Array.isArray(match.completedGames) || !match.completedGames.length) return;
  let touched = false;
  for (let i = 0; i < Math.min(LEAGUE_GAME_COUNT, match.completedGames.length); i++) {
    const row = match.completedGames[i];
    if (!row) continue;
    if (!row.label) row.label = leagueGameLabel(i);
    if (s === 'a') row.playersA = [...lineup.games[i].players];
    else row.playersB = [...lineup.games[i].players];
    touched = true;
  }
  if (touched && typeof match.markModified === 'function') {
    match.markModified('completedGames');
  }
}

/** 計分換局時，從已確認排陣帶出入場球員 */
export function playersFromConfirmedLineup(match, gameIndex) {
  const idx = Number(gameIndex) || 0;
  const a = getSideLineup(match, 'a');
  const b = getSideLineup(match, 'b');
  return {
    playersA: a.confirmed ? [...(a.games[idx]?.players || [])] : [],
    playersB: b.confirmed ? [...(b.games[idx]?.players || [])] : [],
  };
}

/** 顯示／計分用：completedGames 有名優先，否則用已確認排陣 */
export function resolveGamePlayers(match, gameIndex, row = null) {
  const idx = Number(gameIndex) || 0;
  const g = row || match?.completedGames?.[idx] || {};
  const fromRowA = normalizeLineupNames(g.playersA);
  const fromRowB = normalizeLineupNames(g.playersB);
  const board = playersFromConfirmedLineup(match, idx);
  return {
    playersA: fromRowA.length ? fromRowA : board.playersA,
    playersB: fromRowB.length ? fromRowB : board.playersB,
  };
}

/** currentLineup 有名優先，否則用下一局確認排陣 */
export function resolveCurrentPlayers(match) {
  const fromCurrent = lineupFromCurrent(match);
  const idx = Array.isArray(match?.completedGames) ? match.completedGames.length : 0;
  const board = playersFromConfirmedLineup(match, idx);
  return {
    playersA: fromCurrent.playersA.length ? fromCurrent.playersA : board.playersA,
    playersB: fromCurrent.playersB.length ? fromCurrent.playersB : board.playersB,
  };
}

/** 確認排陣後，把該邊／雙方灌入目前進行中回合 */
export function seedCurrentLineupFromBoard(match, side = '') {
  const idx = Array.isArray(match?.completedGames) ? match.completedGames.length : 0;
  if (idx >= LEAGUE_GAME_COUNT) return;
  const board = playersFromConfirmedLineup(match, idx);
  if (!match.currentLineup || typeof match.currentLineup !== 'object') {
    match.currentLineup = { playersA: [], playersB: [] };
  }
  const s = normalizeSide(side);
  let touched = false;
  if ((!s || s === 'a') && !(match.currentLineup.playersA || []).length && board.playersA.length) {
    match.currentLineup.playersA = [...board.playersA];
    touched = true;
  }
  if ((!s || s === 'b') && !(match.currentLineup.playersB || []).length && board.playersB.length) {
    match.currentLineup.playersB = [...board.playersB];
    touched = true;
  }
  if (touched && typeof match.markModified === 'function') {
    match.markModified('currentLineup');
  }
}

export function applySideLineup(match, side, { games, confirm = false, roster } = {}) {
  const s = normalizeSide(side);
  if (!s) return { ok: false, error: 'invalid_side' };
  ensureLineupTokens(match);
  const block = match.lineupBySide[s];
  if (block.confirmed && !confirm) {
    // 已確認仍允許儲存草稿？唔得，要先解鎖
    return { ok: false, error: 'already_confirmed' };
  }
  if (block.confirmed && confirm) {
    return { ok: false, error: 'already_confirmed' };
  }

  const parsed = parseLineupGamesPayload(games, roster);
  const limit = validateAppearanceLimit(parsed);
  if (!limit.ok) return limit;
  if (confirm) {
    const v = validateLineupComplete(parsed);
    if (!v.ok) return v;
  }

  block.games = parsed;
  if (confirm) {
    block.confirmed = true;
    block.confirmedAt = new Date();
    syncLineupToCompletedGames(match, s);
    seedCurrentLineupFromBoard(match, s);
  }
  if (typeof match.markModified === 'function') {
    match.markModified('lineupBySide');
  }
  return { ok: true, lineup: getSideLineup(match, s) };
}

export function unlockSideLineup(match, side) {
  const s = normalizeSide(side);
  if (!s) return { ok: false, error: 'invalid_side' };
  ensureLineupTokens(match);
  match.lineupBySide[s].confirmed = false;
  match.lineupBySide[s].confirmedAt = undefined;
  if (typeof match.markModified === 'function') {
    match.markModified('lineupBySide');
  }
  return { ok: true, lineup: getSideLineup(match, s) };
}

export function teamForSide(match, side) {
  const s = normalizeSide(side);
  if (s === 'a') return match.teamA;
  if (s === 'b') return match.teamB;
  return null;
}

export function opponentForSide(match, side) {
  const s = normalizeSide(side);
  if (s === 'a') return match.teamB;
  if (s === 'b') return match.teamA;
  return null;
}

export { rosterFromTeam, LEAGUE_GAME_LABELS, LEAGUE_GAME_COUNT, leagueGameLabel };
