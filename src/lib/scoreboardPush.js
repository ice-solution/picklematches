import { Match } from '../models/Match.js';
import { Tournament } from '../models/Tournament.js';
import { gamesNeededToWinMatch } from './scoring.js';
import { applyScoreboardToMatch } from './scoreboardToMatch.js';
import { broadcastMatchUpdate } from './matchSocket.js';

/** 依連結場次的賽制，判斷是否已達勝局數 */
export function isScoreboardMatchWon(board) {
  if (!board?.linkedMatchFormat) return false;
  const need = gamesNeededToWinMatch(board.linkedMatchFormat);
  const ga = board.gamesA ?? 0;
  const gb = board.gamesB ?? 0;
  return ga >= need || gb >= need;
}

/** 贏局後若已達勝局數，自動標記完賽 */
export function maybeMarkScoreboardFinished(board) {
  if (board.linkedMatchId && isScoreboardMatchWon(board)) {
    board.status = 'finished';
    return true;
  }
  return false;
}

/**
 * 已連結場次且計分牌為完賽時，自動寫回賽程。
 * @returns {Promise<{ matchId: string, editUrl: string } | null>}
 */
export async function pushScoreboardToLinkedMatchIfFinished(app, board, eventId) {
  if (!board?.linkedMatchId || board.status !== 'finished') return null;

  const match = await Match.findById(board.linkedMatchId);
  if (!match) return null;

  const tournament = await Tournament.findById(match.tournamentId).lean();
  if (!tournament || String(tournament.eventId) !== String(eventId)) return null;

  applyScoreboardToMatch(match, board.toObject ? board.toObject() : board);
  await match.save();
  await broadcastMatchUpdate(app, match._id);

  return {
    matchId: String(match._id),
    editUrl: `/admin/matches/${match._id}/edit`,
  };
}
