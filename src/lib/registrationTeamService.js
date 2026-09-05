import mongoose from 'mongoose';
import { Division } from '../models/Division.js';
import { Registration } from '../models/Registration.js';
import { Team } from '../models/Team.js';
import { Tournament } from '../models/Tournament.js';
import { Match } from '../models/Match.js';
import { assignTeamCodeIfEmpty } from './teamCodes.js';

function teamDisplayName(reg) {
  const name = String(reg.teamName || '').trim();
  if (name) return name;
  const players = String(reg.playerNames || '').trim();
  if (players) return players;
  return `報名 ${String(reg._id).slice(-6)}`;
}

async function countNonPlaceholderTeams(tournamentId) {
  return Team.countDocuments({
    tournamentId,
    isPlaceholder: { $ne: true },
  });
}

/**
 * 已付款（含 $0）報名 → 建立賽事隊伍（未分組）。
 * @returns {{ ok: boolean, promoted?: number, scheduleWarning?: boolean, error?: string, details?: string[] }}
 */
export async function promoteRegistrationsToTeams(registrationIds, { eventId }) {
  const ids = [...new Set((registrationIds || []).map(String))].filter((id) =>
    mongoose.isValidObjectId(id)
  );
  if (!ids.length) return { ok: false, error: 'none_selected' };

  const regs = await Registration.find({
    _id: { $in: ids },
    eventId,
  });
  if (!regs.length) return { ok: false, error: 'not_found' };

  const details = [];
  const eligible = [];

  for (const reg of regs) {
    if (reg.status === 'cancelled' || reg.status === 'failed') {
      details.push(`${teamDisplayName(reg)}：已取消／失敗，無法移入`);
      continue;
    }
    if (reg.status === 'pending_payment') {
      details.push(`${teamDisplayName(reg)}：尚未付款`);
      continue;
    }
    if (reg.teamId || reg.status === 'confirmed') {
      details.push(`${teamDisplayName(reg)}：已移入賽事，不可再移`);
      continue;
    }
    if (reg.status !== 'paid') {
      details.push(`${teamDisplayName(reg)}：狀態不符（${reg.status}）`);
      continue;
    }
    eligible.push(reg);
  }

  if (!eligible.length) {
    return { ok: false, error: 'none_eligible', details };
  }

  const byDivision = new Map();
  for (const reg of eligible) {
    const key = String(reg.divisionId);
    if (!byDivision.has(key)) byDivision.set(key, []);
    byDivision.get(key).push(reg);
  }

  let scheduleWarning = false;
  let promoted = 0;

  for (const [divId, divRegs] of byDivision) {
    const division = await Division.findOne({ _id: divId, eventId }).lean();
    if (!division) {
      details.push(`組別 ${divId}：不存在`);
      continue;
    }
    if (!division.linkedTournamentId) {
      details.push(`${division.name}：尚未綁定賽事，請先在報名組別設定「連結賽事」`);
      continue;
    }

    const tournament = await Tournament.findOne({
      _id: division.linkedTournamentId,
      eventId,
    }).lean();
    if (!tournament) {
      details.push(`${division.name}：連結賽事不存在或不屬於此大會`);
      continue;
    }

    const matchCount = await Match.countDocuments({ tournamentId: tournament._id });
    if (matchCount > 0) scheduleWarning = true;

    const teamCount = await countNonPlaceholderTeams(tournament._id);
    const room = Math.max(0, (division.maxTeams || 0) - teamCount);
    if (divRegs.length > room) {
      details.push(
        `${division.name}：賽事隊伍 ${teamCount}／名額 ${division.maxTeams}，本次欲移入 ${divRegs.length} 隊，超出名額`
      );
      continue;
    }

    for (const reg of divRegs) {
      const team = await Team.create({
        tournamentId: tournament._id,
        name: teamDisplayName(reg),
        groupId: undefined,
      });
      await assignTeamCodeIfEmpty(team);

      reg.teamId = team._id;
      reg.status = 'confirmed';
      await reg.save();
      promoted += 1;
    }
  }

  if (!promoted) {
    return { ok: false, error: 'promote_failed', details, scheduleWarning };
  }

  return { ok: true, promoted, scheduleWarning, details };
}

/**
 * 取消已移入報名：刪除隊伍、標記 cancelled（不可還原）。
 * 若隊伍已出現在場次中則拒絕。
 */
export async function cancelRegistrationAndRemoveTeam(registrationId, { eventId }) {
  if (!mongoose.isValidObjectId(registrationId)) {
    return { ok: false, error: 'not_found' };
  }

  const reg = await Registration.findOne({ _id: registrationId, eventId });
  if (!reg) return { ok: false, error: 'not_found' };
  if (reg.status === 'cancelled') return { ok: false, error: 'already_cancelled' };
  if (reg.status === 'pending_payment' || reg.status === 'failed') {
    return { ok: false, error: 'cannot_cancel_status' };
  }

  if (reg.teamId) {
    const inMatch = await Match.countDocuments({
      $or: [{ teamA: reg.teamId }, { teamB: reg.teamId }, { winnerId: reg.teamId }],
    });
    if (inMatch > 0) {
      return { ok: false, error: 'team_in_matches' };
    }
    await Team.deleteOne({ _id: reg.teamId });
  }

  await Registration.updateOne(
    { _id: reg._id },
    { $set: { status: 'cancelled' }, $unset: { teamId: 1 } }
  );

  return {
    ok: true,
    refundHint: true,
    amountPaid: reg.amountPaid || 0,
  };
}
