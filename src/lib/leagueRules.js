import { MATCH_FORMAT } from '../models/Match.js';

export const LEAGUE_GAME_LABELS = ['男雙', '女雙', '混雙（1）', '混雙（2）', '混雙（3）'];
export const LEAGUE_GAME_COUNT = 5;
export const LEAGUE_POINTS_TO_WIN_GAME = 21;

export function isLeagueFormat(matchFormat) {
  return matchFormat === MATCH_FORMAT.LEAGUE_FIVE;
}

export function leagueGameLabel(index) {
  return LEAGUE_GAME_LABELS[index] || `第 ${index + 1} 場`;
}

/** 單邊先到 21 即結束該回合（21-20 都得，唔使領先 2 分） */
export function isLeagueGameComplete(scoreA, scoreB) {
  const a = Number(scoreA || 0);
  const b = Number(scoreB || 0);
  const hi = Math.max(a, b);
  return hi >= LEAGUE_POINTS_TO_WIN_GAME && a !== b;
}

export function parseRosterNames(raw) {
  const text = String(raw || '');
  const parts = text
    .split(/[\n,，、;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const name of parts) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 24) break;
  }
  return out;
}

export function rosterFromTeam(team) {
  const list = Array.isArray(team?.players) ? team.players : [];
  const names = list
    .map((p) => (typeof p === 'string' ? p : p?.name))
    .map((n) => String(n || '').trim())
    .filter(Boolean);
  return parseRosterNames(names.join('\n'));
}

/** 一回合最多 4 個名（雙打通常 2 人） */
export function normalizeLineupNames(raw) {
  if (Array.isArray(raw)) {
    return parseRosterNames(raw.join('\n')).slice(0, 4);
  }
  return parseRosterNames(raw).slice(0, 4);
}

export function lineupPair(player1, player2) {
  return normalizeLineupNames([player1, player2]);
}

export function formatLineup(names) {
  return (Array.isArray(names) ? names : []).map((n) => String(n || '').trim()).filter(Boolean).join('、');
}

export function gameLineupNote(g) {
  const a = formatLineup(g?.playersA);
  const b = formatLineup(g?.playersB);
  if (!a && !b) return '';
  return `${a || '—'} vs ${b || '—'}`;
}

export function lineupFromCurrent(match) {
  return {
    playersA: normalizeLineupNames(match?.currentLineup?.playersA),
    playersB: normalizeLineupNames(match?.currentLineup?.playersB),
  };
}

export function leagueTotals(match, { includeCurrent = true } = {}) {
  const games = Array.isArray(match?.completedGames) ? match.completedGames : [];
  let ptsA = 0;
  let ptsB = 0;
  for (const g of games) {
    ptsA += Number(g?.a ?? 0);
    ptsB += Number(g?.b ?? 0);
  }
  if (includeCurrent && match?.status !== 'finished') {
    ptsA += Number(match?.currentPoints?.a ?? 0);
    ptsB += Number(match?.currentPoints?.b ?? 0);
  }
  return { ptsA, ptsB };
}

export function leagueWinnerId(match) {
  const teamA = match.teamA?._id ? String(match.teamA._id) : String(match.teamA || '');
  const teamB = match.teamB?._id ? String(match.teamB._id) : String(match.teamB || '');
  if (!teamA || !teamB) return null;
  const { ptsA, ptsB } = leagueTotals(match, { includeCurrent: false });
  if (ptsA > ptsB) return teamA;
  if (ptsB > ptsA) return teamB;
  return null;
}
