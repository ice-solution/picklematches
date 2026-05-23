import mongoose from 'mongoose';
import { Group } from '../models/Group.js';
import { Team } from '../models/Team.js';

/** 從組別名稱取出字母代號（A組 → A） */
export function groupNameToLetter(groupName, fallbackIndex = 0) {
  const s = String(groupName || '').trim();
  const m = s.match(/^([A-Za-z])\s*組?$/i) || s.match(/^([A-Za-z])/);
  if (m) return m[1].toUpperCase();
  if (fallbackIndex >= 0 && fallbackIndex < 26) {
    return String.fromCharCode('A'.charCodeAt(0) + fallbackIndex);
  }
  return 'G';
}

/**
 * 取得或建立組別（匯入用）
 * @returns {Promise<{ group: object, groupByName: Map }>}
 */
export async function ensureGroupByName(tournamentId, groupName, groupByName) {
  let name = String(groupName || '').trim();
  if (!name) name = 'A組';

  let g = groupByName.get(name) || groupByName.get(name.toLowerCase());
  if (!g) {
    const tid = new mongoose.Types.ObjectId(tournamentId);
    const maxOrder = await Group.findOne({ tournamentId: tid }).sort({ order: -1 }).select('order').lean();
    const order = (maxOrder?.order ?? -1) + 1;
    g = await Group.create({ tournamentId: tid, name, order });
    groupByName.set(g.name.trim(), g);
    groupByName.set(g.name.trim().toLowerCase(), g);
  }
  return g;
}

/** 依組別內順序重編隊伍代號（A1、A2…；未分組為 T1、T2） */
export async function syncTeamCodesForTournament(tournamentId) {
  const tid = new mongoose.Types.ObjectId(tournamentId);
  const groups = await Group.find({ tournamentId: tid }).sort({ order: 1, createdAt: 1 });

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const letter = groupNameToLetter(g.name, gi);
    const teams = await Team.find({
      tournamentId: tid,
      groupId: g._id,
      isPlaceholder: { $ne: true },
    })
      .sort({ seed: 1, createdAt: 1, name: 1 });

    for (let i = 0; i < teams.length; i++) {
      const code = `${letter}${i + 1}`;
      if (teams[i].code !== code) {
        teams[i].code = code;
        await teams[i].save();
      }
    }
  }

  const ungrouped = await Team.find({
    tournamentId: tid,
    $or: [{ groupId: null }, { groupId: { $exists: false } }],
    isPlaceholder: { $ne: true },
  }).sort({ createdAt: 1, name: 1 });

  for (let i = 0; i < ungrouped.length; i++) {
    const code = `T${i + 1}`;
    if (ungrouped[i].code !== code) {
      ungrouped[i].code = code;
      await ungrouped[i].save();
    }
  }

  return { updated: true };
}
