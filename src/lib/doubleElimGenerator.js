import mongoose from 'mongoose';
import { Tournament } from '../models/Tournament.js';
import { Team } from '../models/Team.js';
import { Match, MATCH_FORMAT } from '../models/Match.js';
import { Group } from '../models/Group.js';
import { Event } from '../models/Event.js';
import { computeGroupStandings } from './groupStandings.js';
import { venueSlugList } from './venues.js';
import { createCourtTimeAssigner, scheduleDateFromTournament } from './scheduleTiming.js';
import {
  ensureTeamInTournament,
  fillKnockoutSlots,
  letterForIndex,
} from './knockoutGenerator.js';

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function isPow2(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

/** 偶數組 × 每組前 N：交叉對賽順序寫入種子位（1vN、2vN-1…） */
function orderSlotsForCrossSeed(groupCount, takeN) {
  const n = groupCount * takeN;
  const seedArr = new Array(n).fill(null);
  let matchIdx = 0;
  for (let gi = 0; gi < groupCount; gi += 2) {
    const letterA = letterForIndex(gi);
    const letterB = letterForIndex(gi + 1);
    for (let i = 0; i < takeN; i++) {
      seedArr[matchIdx] = `${letterA}${i + 1}`;
      seedArr[n - 1 - matchIdx] = `${letterB}${takeN - i}`;
      matchIdx += 1;
    }
  }
  return seedArr;
}

function parseMatchFormat(raw) {
  const s = String(raw || '').trim();
  if (Object.values(MATCH_FORMAT).includes(s)) return s;
  return MATCH_FORMAT.BEST_OF_3;
}

function resolveCourtSlugs(courts) {
  if (!Array.isArray(courts) || !courts.length) return [];
  if (typeof courts[0] === 'object') return venueSlugList(courts);
  return courts.map((c) => String(c || '').trim()).filter(Boolean);
}

function makeCourtAssigner(courts) {
  const list = resolveCourtSlugs(courts);
  let i = 0;
  return {
    resetRound() {
      i = 0;
    },
    next(skip = false) {
      if (skip || !list.length) return '';
      const c = list[i % list.length];
      i += 1;
      return c;
    },
  };
}

async function ensurePlaceholderTeam(tournamentId, name) {
  const tId = new mongoose.Types.ObjectId(tournamentId);
  const existing = await Team.findOne({ tournamentId: tId, name, isPlaceholder: true });
  if (existing) return existing._id;
  const doc = await Team.create({ tournamentId: tId, name, isPlaceholder: true });
  return doc._id;
}

function winnersRoundLabel(teamsInRound) {
  if (teamsInRound <= 2) return '勝部決賽';
  if (teamsInRound === 4) return '勝部四強';
  if (teamsInRound === 8) return '勝部八強';
  if (teamsInRound === 16) return '勝部16強';
  if (teamsInRound === 32) return '勝部32強';
  return `勝部 R${teamsInRound}`;
}

function losersRoundLabel(idx, isFinal) {
  if (isFinal) return '敗部決賽';
  return `敗部 R${idx + 1}`;
}

/**
 * 產生雙敗淘汰完整籤表（勝部 + 敗部 + 總決賽 1／2）。
 * 總決賽：teamA = 勝部冠軍占位 GF-W；teamB = 敗部冠軍占位 GF-L。
 * 若敗部喺 GF1 反勝，推進邏輯會啟動 GF2（勝部一次優勢）。
 * @param {object[]} [seedTeamIds] 若提供，用呢批隊伍／占位作勝部首輪種子（順序＝種子 1…N）
 */
export async function generateDoubleElimFromTeams({
  tournamentId,
  matchFormat,
  courts,
  timing = null,
  seedTeamIds = null,
}) {
  if (!mongoose.isValidObjectId(tournamentId)) return { ok: false, error: 'invalid_id' };

  const t = await Tournament.findById(tournamentId).lean();
  if (!t) return { ok: false, error: 'not_found' };
  if (t.phase !== 'double_elim') return { ok: false, error: 'target_not_double_elim' };

  const existingMatchCount = await Match.countDocuments({ tournamentId: t._id });
  if (existingMatchCount > 0) return { ok: false, error: 'target_has_matches' };

  let teams;
  if (Array.isArray(seedTeamIds) && seedTeamIds.length) {
    teams = seedTeamIds.map((id) => ({ _id: id }));
  } else {
    teams = await Team.find({
      tournamentId: t._id,
      isPlaceholder: { $ne: true },
    })
      .sort({ seed: 1, createdAt: 1 })
      .select('_id')
      .lean();
  }

  if (teams.length < 2) return { ok: false, error: 'not_enough_teams' };

  let venueList = Array.isArray(courts) ? resolveCourtSlugs(courts) : null;
  if (!venueList) {
    const event = await Event.findById(t.eventId).select('venues').lean();
    venueList = venueSlugList(event?.venues);
  }

  const fmt = parseMatchFormat(matchFormat);
  const assignCourt = makeCourtAssigner(venueList);
  const timeAssign = createCourtTimeAssigner({
    startTime: timing?.startTime,
    startMinutes: timing?.startMinutes,
    slotMinutes: timing?.slotMinutes,
  });
  const scheduleDate = scheduleDateFromTournament(t);
  function courtAndTime(isBye = false) {
    const court = assignCourt.next(isBye);
    return {
      court,
      scheduledTime: timeAssign.next(court, { skip: isBye }),
      scheduledDate: scheduleDate,
    };
  }
  const byeId = await ensurePlaceholderTeam(t._id, 'BYE');
  const bracketSize = nextPow2(teams.length);
  const createdMatchIds = [];

  // —— 勝部 ——
  const wRounds = []; // each: { label, matchCount, matches: [{id, winSlot, loseSlot}] }
  let size = bracketSize;
  let wRoundIdx = 0;
  while (size >= 2) {
    const matchCount = size / 2;
    const label = winnersRoundLabel(size);
    const roundMatches = [];
    assignCourt.resetRound();

    for (let i = 0; i < matchCount; i++) {
      let teamA;
      let teamB;
      let isBye = false;

      if (wRoundIdx === 0) {
        const seedArr = new Array(bracketSize).fill(byeId);
        for (let si = 0; si < teams.length; si++) seedArr[si] = teams[si]._id;
        const s1 = i + 1;
        const s2 = bracketSize + 1 - s1;
        teamA = seedArr[s1 - 1];
        teamB = seedArr[s2 - 1];
        isBye =
          (String(teamA) !== String(byeId) && String(teamB) === String(byeId)) ||
          (String(teamB) !== String(byeId) && String(teamA) === String(byeId));
      } else {
        const prev = wRounds[wRoundIdx - 1];
        const aSlot = prev.matches[i * 2].winSlot;
        const bSlot = prev.matches[i * 2 + 1].winSlot;
        teamA = await ensurePlaceholderTeam(t._id, aSlot);
        teamB = await ensurePlaceholderTeam(t._id, bSlot);
      }

      const winSlot = size === 2 ? 'GF-W' : `W${wRoundIdx + 1}-M${i}-W`;
      // 勝部決賽敗者入敗部決賽；其餘入敗部對應 drop-in
      let loseSlot;
      if (size === 2) {
        loseSlot = 'LF-DROP';
      } else {
        loseSlot = `W${wRoundIdx}-M${i}-L`;
      }

      const m = await Match.create({
        tournamentId: t._id,
        round: label,
        matchFormat: fmt,
        teamA,
        teamB,
        ...courtAndTime(isBye),
        status: isBye ? 'finished' : 'scheduled',
        completedGames: [],
        currentGameIndex: 0,
        currentPoints: { a: 0, b: 0 },
        winnerId: isBye
          ? String(teamA) !== String(byeId)
            ? teamA
            : teamB
          : undefined,
        knockoutWinnerSlot: winSlot,
        knockoutLoserSlot: loseSlot,
        bracketTrack: 'winners',
      });
      createdMatchIds.push(m._id);
      roundMatches.push({ id: m._id, winSlot, loseSlot, index: i });
    }

    wRounds.push({ label, matchCount, matches: roundMatches, teamsInRound: size });
    size = size / 2;
    wRoundIdx += 1;
  }

  // —— 敗部 ——
  const lRounds = [];
  const firstW = wRounds[0];
  let lRoundIdx = 0;

  // 僅 2 隊：無獨立敗部輪，勝部決賽敗者直接入 GF-L
  if (bracketSize === 2) {
    // 覆寫勝部決賽 loser slot → GF-L
    const wf = await Match.findById(firstW.matches[0].id);
    if (wf) {
      wf.knockoutLoserSlot = 'GF-L';
      await wf.save();
      firstW.matches[0].loseSlot = 'GF-L';
    }
  } else {
    // L0: 配對第一輪勝部敗者
    let lMatchCount = firstW.matchCount / 2;
    if (lMatchCount >= 1) {
      const label = losersRoundLabel(lRoundIdx, false);
      const roundMatches = [];
      assignCourt.resetRound();
      for (let i = 0; i < lMatchCount; i++) {
        const aSlot = firstW.matches[i * 2].loseSlot;
        const bSlot = firstW.matches[i * 2 + 1].loseSlot;
        const teamA = await ensurePlaceholderTeam(t._id, aSlot);
        const teamB = await ensurePlaceholderTeam(t._id, bSlot);
        const winSlot = `L${lRoundIdx}-M${i}-W`;
        const m = await Match.create({
          tournamentId: t._id,
          round: label,
          matchFormat: fmt,
          teamA,
          teamB,
          ...courtAndTime(),
          status: 'scheduled',
          completedGames: [],
          currentGameIndex: 0,
          currentPoints: { a: 0, b: 0 },
          knockoutWinnerSlot: winSlot,
          knockoutLoserSlot: null,
          bracketTrack: 'losers',
        });
        createdMatchIds.push(m._id);
        roundMatches.push({ id: m._id, winSlot, index: i });
      }
      lRounds.push({ label, matches: roundMatches });
      lRoundIdx += 1;
    }

    // 中間勝部輪（不含最後決賽）：drop-in + 必要時 consolidation
    for (let wr = 1; wr < wRounds.length - 1; wr++) {
      const wRound = wRounds[wr];
      const prevL = lRounds[lRounds.length - 1];
      const dropCount = wRound.matchCount;

      {
        const label = losersRoundLabel(lRoundIdx, false);
        const roundMatches = [];
        assignCourt.resetRound();
        for (let i = 0; i < dropCount; i++) {
          const aSlot = prevL.matches[i].winSlot;
          const bSlot = wRound.matches[i].loseSlot;
          const teamA = await ensurePlaceholderTeam(t._id, aSlot);
          const teamB = await ensurePlaceholderTeam(t._id, bSlot);
          const winSlot = `L${lRoundIdx}-M${i}-W`;
          const m = await Match.create({
            tournamentId: t._id,
            round: label,
            matchFormat: fmt,
            teamA,
            teamB,
            ...courtAndTime(),
            status: 'scheduled',
            completedGames: [],
            currentGameIndex: 0,
            currentPoints: { a: 0, b: 0 },
            knockoutWinnerSlot: winSlot,
            knockoutLoserSlot: null,
            bracketTrack: 'losers',
          });
          createdMatchIds.push(m._id);
          roundMatches.push({ id: m._id, winSlot, index: i });
        }
        lRounds.push({ label, matches: roundMatches });
        lRoundIdx += 1;
      }

      let cur = lRounds[lRounds.length - 1];
      const nextW = wRounds[wr + 1];
      while (nextW && cur.matches.length > nextW.matchCount) {
        const label = losersRoundLabel(lRoundIdx, false);
        const half = cur.matches.length / 2;
        const roundMatches = [];
        assignCourt.resetRound();
        for (let i = 0; i < half; i++) {
          const aSlot = cur.matches[i * 2].winSlot;
          const bSlot = cur.matches[i * 2 + 1].winSlot;
          const teamA = await ensurePlaceholderTeam(t._id, aSlot);
          const teamB = await ensurePlaceholderTeam(t._id, bSlot);
          const winSlot = `L${lRoundIdx}-M${i}-W`;
          const m = await Match.create({
            tournamentId: t._id,
            round: label,
            matchFormat: fmt,
            teamA,
            teamB,
            ...courtAndTime(),
            status: 'scheduled',
            completedGames: [],
            currentGameIndex: 0,
            currentPoints: { a: 0, b: 0 },
            knockoutWinnerSlot: winSlot,
            knockoutLoserSlot: null,
            bracketTrack: 'losers',
          });
          createdMatchIds.push(m._id);
          roundMatches.push({ id: m._id, winSlot, index: i });
        }
        lRounds.push({ label, matches: roundMatches });
        cur = lRounds[lRounds.length - 1];
        lRoundIdx += 1;
      }
    }

    // 敗部決賽：敗部線冠軍 vs 勝部決賽敗者
    {
      const prevL = lRounds[lRounds.length - 1];
      const aSlot = prevL.matches[0].winSlot;
      const bSlot = 'LF-DROP';
      const teamA = await ensurePlaceholderTeam(t._id, aSlot);
      const teamB = await ensurePlaceholderTeam(t._id, bSlot);
      assignCourt.resetRound();
      const m = await Match.create({
        tournamentId: t._id,
        round: '敗部決賽',
        matchFormat: fmt,
        teamA,
        teamB,
        ...courtAndTime(),
        status: 'scheduled',
        completedGames: [],
        currentGameIndex: 0,
        currentPoints: { a: 0, b: 0 },
        knockoutWinnerSlot: 'GF-L',
        knockoutLoserSlot: null,
        bracketTrack: 'losers',
      });
      createdMatchIds.push(m._id);
      lRounds.push({ label: '敗部決賽', matches: [{ id: m._id, winSlot: 'GF-L', index: 0 }] });
    }
  }

  // —— 總決賽 ——
  const gfW = await ensurePlaceholderTeam(t._id, 'GF-W');
  const gfL = await ensurePlaceholderTeam(t._id, 'GF-L');
  assignCourt.resetRound();
  const gf1 = await Match.create({
    tournamentId: t._id,
    round: '總決賽',
    matchFormat: fmt,
    teamA: gfW,
    teamB: gfL,
    ...courtAndTime(),
    status: 'scheduled',
    completedGames: [],
    currentGameIndex: 0,
    currentPoints: { a: 0, b: 0 },
    knockoutWinnerSlot: null,
    knockoutLoserSlot: null,
    bracketTrack: 'grand_final',
    grandFinalLeg: 1,
  });
  createdMatchIds.push(gf1._id);

  const gf2A = await ensurePlaceholderTeam(t._id, 'GF2-A');
  const gf2B = await ensurePlaceholderTeam(t._id, 'GF2-B');
  // GF2 預留、未確定是否開打：仍排時間但不佔場地（與舊行為 court:'' 一致）
  const gf2Time = timeAssign.next('', { skip: false });
  const gf2 = await Match.create({
    tournamentId: t._id,
    round: '總決賽（若需要）',
    matchFormat: fmt,
    teamA: gf2A,
    teamB: gf2B,
    court: '',
    scheduledTime: gf2Time,
    scheduledDate: scheduleDate,
    status: 'scheduled',
    completedGames: [],
    currentGameIndex: 0,
    currentPoints: { a: 0, b: 0 },
    knockoutWinnerSlot: null,
    knockoutLoserSlot: null,
    bracketTrack: 'grand_final',
    grandFinalLeg: 2,
  });
  createdMatchIds.push(gf2._id);

  // 處理勝部首輪 BYE：自動推進 slot
  const finishedFirst = await Match.find({
    tournamentId: t._id,
    bracketTrack: 'winners',
    status: 'finished',
    winnerId: { $ne: null },
  });
  for (const m of finishedFirst) {
    const slotToTeamId = {};
    if (m.knockoutWinnerSlot) slotToTeamId[m.knockoutWinnerSlot] = m.winnerId;
    // BYE 敗方唔推進真人
    const a = String(m.teamA);
    const b = String(m.teamB);
    const loser = String(m.winnerId) === a ? b : a;
    if (m.knockoutLoserSlot && loser !== String(byeId)) {
      slotToTeamId[m.knockoutLoserSlot] = loser;
    } else if (m.knockoutLoserSlot && loser === String(byeId)) {
      slotToTeamId[m.knockoutLoserSlot] = byeId;
    }
    await fillKnockoutSlots(t._id, slotToTeamId);
  }

  return {
    ok: true,
    createdTeams: teams.length,
    createdMatches: createdMatchIds.length,
    matchFormat: fmt,
    courtsUsed: (venueList || []).length,
    bracketSize,
    timingApplied: timeAssign.enabled,
  };
}

/**
 * 預排雙敗：勝部首輪用 A1／B2… 占位（小組未完亦可），其餘敗部／總決賽用 W/L slot。
 * 小組打完後再呼叫 generateDoubleElimFromGroup，只填真隊、唔改時間場地。
 */
export async function generateDoubleElimSlotBracket({
  tournamentId,
  sourceTournamentId,
  advancePerGroup,
  matchFormat,
  courts,
  timing = null,
}) {
  if (!mongoose.isValidObjectId(tournamentId) || !mongoose.isValidObjectId(sourceTournamentId)) {
    return { ok: false, error: 'invalid_id' };
  }

  const de = await Tournament.findById(tournamentId).lean();
  const src = await Tournament.findById(sourceTournamentId).lean();
  if (!src || !de) return { ok: false, error: 'not_found' };
  if (src.phase !== 'group') return { ok: false, error: 'source_not_group' };
  if (de.phase !== 'double_elim') return { ok: false, error: 'target_not_double_elim' };
  if (String(src.eventId) !== String(de.eventId)) return { ok: false, error: 'different_event' };

  const existingMatchCount = await Match.countDocuments({ tournamentId: de._id });
  if (existingMatchCount > 0) return { ok: false, error: 'target_has_matches' };

  const groups = await Group.find({ tournamentId: src._id }).sort({ order: 1, createdAt: 1 }).lean();
  if (!groups.length) return { ok: false, error: 'no_groups' };

  const takeN = Math.max(1, parseInt(advancePerGroup ?? src.advancePerGroup ?? 2, 10) || 2);
  const slotCount = groups.length * takeN;
  if (slotCount < 2) return { ok: false, error: 'not_enough_qualifiers' };

  await Tournament.updateOne(
    { _id: tournamentId },
    {
      $set: {
        sourceGroupTournamentId: sourceTournamentId,
        ...(src.competitionDate ? { competitionDate: String(src.competitionDate).trim() } : {}),
      },
    }
  );

  const canCross = isPow2(slotCount) && groups.length % 2 === 0;
  const slots = canCross
    ? orderSlotsForCrossSeed(groups.length, takeN)
    : (() => {
        const list = [];
        for (let gi = 0; gi < groups.length; gi++) {
          const letter = letterForIndex(gi);
          for (let r = 1; r <= takeN; r++) list.push(`${letter}${r}`);
        }
        return list;
      })();

  const seedTeamIds = [];
  for (const name of slots) {
    seedTeamIds.push(await ensurePlaceholderTeam(de._id, name));
  }

  const r = await generateDoubleElimFromTeams({
    tournamentId,
    matchFormat,
    courts,
    timing,
    seedTeamIds,
  });
  if (!r.ok) return r;
  return { ...r, slots, preseed: true };
}

/**
 * 由小組賽出線填入雙敗（同單敗流程）：
 * - 已有預排場次：只把 A1／B2… 換成真隊
 * - 未預排：新建完整雙敗籤表
 */
export async function generateDoubleElimFromGroup({
  sourceTournamentId,
  tournamentId,
  advancePerGroup,
  matchFormat,
  courts,
  timing = null,
}) {
  if (!mongoose.isValidObjectId(sourceTournamentId) || !mongoose.isValidObjectId(tournamentId)) {
    return { ok: false, error: 'invalid_id' };
  }

  const src = await Tournament.findById(sourceTournamentId).lean();
  const de = await Tournament.findById(tournamentId).lean();
  if (!src || !de) return { ok: false, error: 'not_found' };
  if (src.phase !== 'group') return { ok: false, error: 'source_not_group' };
  if (de.phase !== 'double_elim') return { ok: false, error: 'target_not_double_elim' };
  if (String(src.eventId) !== String(de.eventId)) return { ok: false, error: 'different_event' };

  await Tournament.updateOne(
    { _id: tournamentId },
    {
      $set: {
        sourceGroupTournamentId: sourceTournamentId,
        ...(src.competitionDate ? { competitionDate: String(src.competitionDate).trim() } : {}),
      },
    }
  );

  const existingMatchCount = await Match.countDocuments({ tournamentId: de._id });
  const groups = await Group.find({ tournamentId: src._id }).sort({ order: 1, createdAt: 1 }).lean();
  if (!groups.length) return { ok: false, error: 'no_groups' };

  const finishedGroupMatches = await Match.countDocuments({
    tournamentId: src._id,
    status: 'finished',
  });
  if (finishedGroupMatches === 0) {
    return { ok: false, error: 'group_not_finished' };
  }

  const standings = await computeGroupStandings(src._id);
  const takeN = Math.max(1, parseInt(advancePerGroup ?? src.advancePerGroup ?? 2, 10) || 2);

  const qualifiers = [];
  for (const block of standings) {
    const picked = block.rows.slice(0, takeN);
    for (let i = 0; i < picked.length; i++) {
      qualifiers.push({
        sourceTeamId: picked[i].teamId,
        name: picked[i].name,
        groupId: String(block.group._id),
        groupName: block.group.name,
        rankInGroup: i + 1,
      });
    }
  }
  if (qualifiers.length < 2) return { ok: false, error: 'not_enough_qualifiers' };

  qualifiers.sort((a, b) => {
    const ag = groups.findIndex((g) => String(g._id) === a.groupId);
    const bg = groups.findIndex((g) => String(g._id) === b.groupId);
    if (ag !== bg) return ag - bg;
    return a.rankInGroup - b.rankInGroup;
  });

  const sourceTeams = await Team.find({ _id: { $in: qualifiers.map((q) => q.sourceTeamId) } })
    .select('_id name code')
    .lean();
  const srcById = new Map(sourceTeams.map((t) => [String(t._id), t]));

  const deTeamIds = [];
  for (const q of qualifiers) {
    const t = srcById.get(String(q.sourceTeamId));
    if (!t) continue;
    deTeamIds.push(await ensureTeamInTournament(de._id, t));
  }

  if (existingMatchCount > 0) {
    const slotToTeamId = {};
    for (let gi = 0; gi < groups.length; gi++) {
      const letter = letterForIndex(gi);
      for (let r = 1; r <= takeN; r++) {
        const q = qualifiers.find(
          (x) => String(x.groupId) === String(groups[gi]._id) && x.rankInGroup === r
        );
        if (!q) continue;
        const idx = qualifiers.indexOf(q);
        if (idx >= 0 && deTeamIds[idx]) {
          slotToTeamId[`${letter}${r}`] = deTeamIds[idx];
        }
      }
    }
    const filledIds = await fillKnockoutSlots(de._id, slotToTeamId);
    return {
      ok: true,
      createdTeams: deTeamIds.length,
      createdMatches: 0,
      updatedMatches: filledIds.length,
    };
  }

  const canCross = isPow2(deTeamIds.length) && groups.length % 2 === 0 && deTeamIds.length === qualifiers.length;
  let seedTeamIds = deTeamIds;
  if (canCross) {
    const byGroup = new Map();
    for (let i = 0; i < qualifiers.length; i++) {
      const q = qualifiers[i];
      const gid = String(q.groupId);
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid).push({ rank: q.rankInGroup, teamId: deTeamIds[i] });
    }
    for (const arr of byGroup.values()) arr.sort((a, b) => a.rank - b.rank);

    const orderedSlots = orderSlotsForCrossSeed(groups.length, takeN);
    const slotToId = {};
    for (let gi = 0; gi < groups.length; gi++) {
      const letter = letterForIndex(gi);
      const ranks = byGroup.get(String(groups[gi]._id)) || [];
      for (let r = 1; r <= takeN; r++) {
        const row = ranks.find((x) => x.rank === r);
        if (row) slotToId[`${letter}${r}`] = row.teamId;
      }
    }
    seedTeamIds = orderedSlots.map((s) => slotToId[s]).filter(Boolean);
    if (seedTeamIds.length !== deTeamIds.length) seedTeamIds = deTeamIds;
  }

  return generateDoubleElimFromTeams({
    tournamentId,
    matchFormat,
    courts,
    timing,
    seedTeamIds,
  });
}

/**
 * 組建雙軌籤表顯示資料
 * @returns {{ winners: Array<{label, matches}>, losers: Array<{label, matches}>, grandFinal: object[] }}
 */
export function buildDoubleElimTracks(matches) {
  const winnersMap = new Map();
  const losersMap = new Map();
  const grandFinal = [];

  for (const m of matches || []) {
    const track = m.bracketTrack || '';
    if (track === 'grand_final') {
      grandFinal.push(m);
      continue;
    }
    const label = (m.round && String(m.round).trim()) || '（未填）';
    const map = track === 'losers' ? losersMap : winnersMap;
    // 無 bracketTrack 嘅舊資料：用輪次前綴推斷
    if (!track) {
      if (/敗部/.test(label)) {
        if (!losersMap.has(label)) losersMap.set(label, []);
        losersMap.get(label).push(m);
      } else if (/總決賽/.test(label)) {
        grandFinal.push(m);
      } else {
        if (!winnersMap.has(label)) winnersMap.set(label, []);
        winnersMap.get(label).push(m);
      }
      continue;
    }
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(m);
  }

  const sortCols = (map) => {
    const cols = [...map.entries()].map(([label, list]) => {
      list.sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return ta - tb;
      });
      return { label, matches: list };
    });
    // 保持產生順序：用第一場 createdAt
    cols.sort((a, b) => {
      const ta = a.matches[0]?.createdAt ? new Date(a.matches[0].createdAt).getTime() : 0;
      const tb = b.matches[0]?.createdAt ? new Date(b.matches[0].createdAt).getTime() : 0;
      return ta - tb;
    });
    return cols;
  };

  grandFinal.sort((a, b) => (a.grandFinalLeg || 1) - (b.grandFinalLeg || 1));

  return {
    winners: sortCols(winnersMap),
    losers: sortCols(losersMap),
    grandFinal,
  };
}
