import { Match } from '../models/Match.js';
import { Tournament } from '../models/Tournament.js';
import { inferMatchWinnerId } from './matchResult.js';
import { fillKnockoutSlots } from './knockoutGenerator.js';

/**
 * 淘汰場次完賽後，依 knockoutWinnerSlot / knockoutLoserSlot 填入決賽、季軍賽占位隊伍
 */
export async function advanceKnockoutFromFinishedMatch(matchId) {
  const match = await Match.findById(matchId).populate('teamA teamB');
  if (!match || match.status !== 'finished') return { updated: 0 };

  const tournament = await Tournament.findById(match.tournamentId).lean();
  if (!tournament || tournament.phase !== 'knockout') return { updated: 0 };

  const winSlot = match.knockoutWinnerSlot?.trim();
  const loseSlot = match.knockoutLoserSlot?.trim();
  if (!winSlot && !loseSlot) return { updated: 0, matchIds: [] };

  const winner = inferMatchWinnerId(match);
  if (!winner) return { updated: 0, matchIds: [] };

  const teamA = String(match.teamA?._id ?? match.teamA);
  const teamB = String(match.teamB?._id ?? match.teamB);
  const loser = winner === teamA ? teamB : teamA;

  const slotToTeamId = {};
  if (winSlot) slotToTeamId[winSlot] = winner;
  if (loseSlot) slotToTeamId[loseSlot] = loser;

  const matchIds = await fillKnockoutSlots(match.tournamentId, slotToTeamId);
  return { updated: matchIds.length, matchIds };
}
