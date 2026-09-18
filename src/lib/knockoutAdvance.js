import { Match } from '../models/Match.js';
import { Tournament } from '../models/Tournament.js';
import { Team } from '../models/Team.js';
import { inferMatchWinnerId } from './matchResult.js';
import { fillKnockoutSlots } from './knockoutGenerator.js';

/**
 * 淘汰／雙敗場次完賽後推進占位；雙敗總決賽含勝部一次優勢（GF2）。
 */
export async function advanceKnockoutFromFinishedMatch(matchId) {
  const match = await Match.findById(matchId).populate('teamA teamB');
  if (!match || match.status !== 'finished') return { updated: 0, matchIds: [] };

  const tournament = await Tournament.findById(match.tournamentId).lean();
  if (!tournament) return { updated: 0, matchIds: [] };

  const isDouble = tournament.phase === 'double_elim';
  const isSingleKo = tournament.phase === 'knockout';
  if (!isDouble && !isSingleKo) return { updated: 0, matchIds: [] };

  const winner = inferMatchWinnerId(match);
  if (!winner) return { updated: 0, matchIds: [] };

  const teamA = String(match.teamA?._id ?? match.teamA);
  const teamB = String(match.teamB?._id ?? match.teamB);
  const loser = winner === teamA ? teamB : teamA;

  // —— 雙敗：總決賽第一場 ——
  if (isDouble && match.bracketTrack === 'grand_final' && match.grandFinalLeg === 1) {
    const matchIds = [];
    // teamA = 勝部冠軍（GF-W）；teamB = 敗部冠軍（GF-L）
    // 勝部贏 → 完結；敗部贏 → 啟動 GF2（兩邊再打一場）
    const winnersSideWon = winner === teamA;
    if (!winnersSideWon) {
      const gf2 = await Match.findOne({
        tournamentId: match.tournamentId,
        bracketTrack: 'grand_final',
        grandFinalLeg: 2,
      });
      if (gf2) {
        // 兩隊都係真人
        gf2.teamA = match.teamA._id ?? match.teamA;
        gf2.teamB = match.teamB._id ?? match.teamB;
        // 清走占位顯示
        await gf2.save();
        matchIds.push(gf2._id);
        // 若占位隊名仍係 GF2-A/B，直接改成真實隊伍 ID（上面已做）
      }
    } else {
      // 勝部一次優勢成立：取消／略過 GF2（標記 cancelled）
      await Match.updateOne(
        {
          tournamentId: match.tournamentId,
          bracketTrack: 'grand_final',
          grandFinalLeg: 2,
          status: { $ne: 'finished' },
        },
        { $set: { status: 'cancelled' } }
      );
      const gf2 = await Match.findOne({
        tournamentId: match.tournamentId,
        bracketTrack: 'grand_final',
        grandFinalLeg: 2,
      })
        .select('_id')
        .lean();
      if (gf2) matchIds.push(gf2._id);
    }
    return { updated: matchIds.length, matchIds };
  }

  if (isDouble && match.bracketTrack === 'grand_final' && match.grandFinalLeg === 2) {
    return { updated: 0, matchIds: [] };
  }

  const winSlot = match.knockoutWinnerSlot?.trim();
  const loseSlot = match.knockoutLoserSlot?.trim();
  if (!winSlot && !loseSlot) return { updated: 0, matchIds: [] };

  const bye = await Team.findOne({
    tournamentId: match.tournamentId,
    name: 'BYE',
    isPlaceholder: true,
  })
    .select('_id')
    .lean();
  const byeId = bye?._id ? String(bye._id) : null;

  const slotToTeamId = {};
  if (winSlot) slotToTeamId[winSlot] = winner;
  if (loseSlot && loser !== byeId) {
    slotToTeamId[loseSlot] = loser;
  } else if (loseSlot && loser === byeId && byeId) {
    slotToTeamId[loseSlot] = bye._id;
  }

  const matchIds = await fillKnockoutSlots(match.tournamentId, slotToTeamId);
  return { updated: matchIds.length, matchIds };
}
