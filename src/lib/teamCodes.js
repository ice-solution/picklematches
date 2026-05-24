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

function nextCodeForLetter(existingCodes, letter) {
  let maxN = 0;
  const re = new RegExp(`^${letter}(\\d+)$`, 'i');
  for (const c of existingCodes) {
    const m = String(c || '').trim().match(re);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return `${letter}${maxN + 1}`;
}

function nextUngroupedCode(existingCodes) {
  let maxN = 0;
  for (const c of existingCodes) {
    const m = String(c || '').trim().match(/^T(\d+)$/i);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return `T${maxN + 1}`;
}

/**
 * 僅為單一隊伍補代號（已有代號則不動）。
 * 有組別 → A1、B2…；未分組 → T1、T2…
 */
export async function assignTeamCodeIfEmpty(teamDoc) {
  if (!teamDoc || teamDoc.isPlaceholder) return teamDoc;
  if (String(teamDoc.code || '').trim()) return teamDoc;

  const tid = new mongoose.Types.ObjectId(teamDoc.tournamentId);
  const gid = teamDoc.groupId ? new mongoose.Types.ObjectId(teamDoc.groupId) : null;

  if (gid) {
    const group = await Group.findOne({ _id: gid, tournamentId: tid }).lean();
    if (group) {
      const groups = await Group.find({ tournamentId: tid }).sort({ order: 1, createdAt: 1 }).lean();
      const gi = groups.findIndex((g) => String(g._id) === String(group._id));
      const letter = groupNameToLetter(group.name, gi >= 0 ? gi : 0);
      const siblings = await Team.find({
        tournamentId: tid,
        groupId: gid,
        isPlaceholder: { $ne: true },
        _id: { $ne: teamDoc._id },
      })
        .select('code')
        .lean();
      teamDoc.code = nextCodeForLetter(
        siblings.map((t) => t.code),
        letter
      );
      await teamDoc.save();
      return teamDoc;
    }
  }

  const ungrouped = await Team.find({
    tournamentId: tid,
    $or: [{ groupId: null }, { groupId: { $exists: false } }],
    isPlaceholder: { $ne: true },
    _id: { $ne: teamDoc._id },
  })
    .select('code')
    .lean();
  teamDoc.code = nextUngroupedCode(ungrouped.map((t) => t.code));
  await teamDoc.save();
  return teamDoc;
}

/**
 * 依組別內順序重編隊伍代號（A1、A2…；未分組為 T1、T2）。
 * @param {{ onlyIfEmpty?: boolean }} options — 預設 true：只補空白代號，不覆蓋既有（含手動設定）
 */
export async function syncTeamCodesForTournament(tournamentId, options = {}) {
  const onlyIfEmpty = options.onlyIfEmpty !== false;
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
      if (onlyIfEmpty && String(teams[i].code || '').trim()) continue;
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
    if (onlyIfEmpty && String(ungrouped[i].code || '').trim()) continue;
    if (ungrouped[i].code !== code) {
      ungrouped[i].code = code;
      await ungrouped[i].save();
    }
  }

  return { updated: true };
}
