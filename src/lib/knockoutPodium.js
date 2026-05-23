import { inferMatchWinnerId } from './matchResult.js';

function teamDisplayName(team) {
  if (!team) return '';
  const n = team.name || '';
  if (team.isPlaceholder && /^[WL]-/.test(n)) return '';
  if (team.isPlaceholder && /^(TBD|BYE)$/i.test(n)) return '';
  return n;
}

function loserId(match, winnerId) {
  const w = String(winnerId || '');
  const a = String(match.teamA?._id || match.teamA || '');
  const b = String(match.teamB?._id || match.teamB || '');
  if (w === a) return match.teamB;
  if (w === b) return match.teamA;
  return null;
}

function isThirdPlaceRound(round) {
  return /季軍|季軍戰|銅牌|第三名|third/i.test(String(round || ''));
}

function isFinalRound(round) {
  const s = String(round || '');
  if (isThirdPlaceRound(s)) return false;
  if (/準決|半決|四強|八強|16強|32強|十六|三十二/i.test(s)) return false;
  return /決賽|冠軍|冠軍賽|final/i.test(s);
}

/** 完賽或已錄入可判勝的比分（避免狀態仍為 scheduled 時獎台空白） */
function matchFinished(m) {
  if (!m) return false;
  const winner = inferMatchWinnerId(m);
  if (!winner) return false;
  if (m.status === 'finished') return true;
  const games = m.completedGames || [];
  if (!games.length) return false;
  return games.some((g) => Number(g?.a ?? 0) + Number(g?.b ?? 0) > 0);
}

/**
 * @param {Array<object>} matches — populate teamA, teamB, winnerId
 * @returns {{ gold: string, silver: string, bronze: string, ready: boolean } | null}
 */
export function getPodiumFromKnockoutMatches(matches) {
  if (!matches?.length) return null;

  let finalMatch = null;
  let thirdMatch = null;
  for (const m of matches) {
    const r = m.round || '';
    if (isThirdPlaceRound(r)) thirdMatch = m;
    else if (isFinalRound(r)) finalMatch = m;
  }

  if (!finalMatch && !thirdMatch) return null;

  const podium = { gold: '', silver: '', bronze: '', ready: false };

  if (finalMatch && matchFinished(finalMatch)) {
    const wId = inferMatchWinnerId(finalMatch);
    const winner = finalMatch.winnerId || (String(finalMatch.teamA?._id) === String(wId) ? finalMatch.teamA : finalMatch.teamB);
    const loser = loserId(finalMatch, wId);
    podium.gold = teamDisplayName(winner) || '—';
    podium.silver = teamDisplayName(loser) || '—';
    podium.ready = !!(podium.gold && podium.silver);
  }

  if (thirdMatch && matchFinished(thirdMatch)) {
    const wId = inferMatchWinnerId(thirdMatch);
    const winner = thirdMatch.winnerId || (String(thirdMatch.teamA?._id) === String(wId) ? thirdMatch.teamA : thirdMatch.teamB);
    podium.bronze = teamDisplayName(winner) || '—';
    if (podium.bronze) podium.ready = true;
  }

  if (!podium.gold && !podium.silver && !podium.bronze) {
    return { gold: '', silver: '', bronze: '', ready: false, pending: true };
  }

  return podium;
}
