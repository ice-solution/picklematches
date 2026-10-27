import mongoose from 'mongoose';
import { Tournament } from '../models/Tournament.js';
import { Team } from '../models/Team.js';
import { Match, MATCH_FORMAT } from '../models/Match.js';
import { Group } from '../models/Group.js';
import { Event } from '../models/Event.js';
import { computeGroupStandings } from './groupStandings.js';
import { venueSlugList } from './venues.js';
import { createCourtTimeAssigner, scheduleDateFromTournament } from './scheduleTiming.js';

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function roundLabelForSize(size) {
  if (size <= 2) return '決賽';
  if (size === 4) return '四強';
  if (size === 8) return '八強';
  if (size === 16) return '16強';
  if (size === 32) return '32強';
  return `R${size}`;
}

function seedPairs(size) {
  // Standard: 1vN, 2v(N-1), ...
  const pairs = [];
  for (let i = 1; i <= size / 2; i++) {
    pairs.push([i, size + 1 - i]);
  }
  return pairs;
}

function isPow2(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

function letterForIndex(i) {
  const A = 'A'.charCodeAt(0);
  if (i < 26) return String.fromCharCode(A + i);
  const hi = Math.floor(i / 26) - 1;
  const lo = i % 26;
  return String.fromCharCode(A + hi) + String.fromCharCode(A + lo);
}

export async function fillKnockoutSlots(koTournamentId, slotToTeamId) {
  const matches = await Match.find({ tournamentId: koTournamentId }).populate('teamA teamB').exec();
  const bye = await Team.findOne({ tournamentId: koTournamentId, name: 'BYE', isPlaceholder: true }).lean();
  const byeId = bye?._id ? String(bye._id) : null;

  const updatedIds = [];
  for (const m of matches) {
    const a = m.teamA;
    const b = m.teamB;
    let changed = false;

    if (a?.isPlaceholder && slotToTeamId[a.name]) {
      m.teamA = slotToTeamId[a.name];
      changed = true;
    }
    if (b?.isPlaceholder && slotToTeamId[b.name]) {
      m.teamB = slotToTeamId[b.name];
      changed = true;
    }

    const aId = String(m.teamA);
    const bId = String(m.teamB);
    if (byeId && aId !== byeId && bId === byeId) {
      m.status = 'finished';
      m.winnerId = m.teamA;
      m.currentPoints = { a: 0, b: 0 };
      changed = true;
    }
    if (byeId && bId !== byeId && aId === byeId) {
      m.status = 'finished';
      m.winnerId = m.teamB;
      m.currentPoints = { a: 0, b: 0 };
      changed = true;
    }

    if (changed) {
      await m.save();
      updatedIds.push(m._id);
    }
  }
  return updatedIds;
}

async function ensurePlaceholderTeam(tournamentId, name) {
  const tId = new mongoose.Types.ObjectId(tournamentId);
  const existing = await Team.findOne({ tournamentId: tId, name, isPlaceholder: true });
  if (existing) return existing._id;
  const doc = await Team.create({ tournamentId: tId, name, isPlaceholder: true });
  return doc._id;
}

async function ensureTeamInTournament(knockoutTournamentId, sourceTeam) {
  const tid = new mongoose.Types.ObjectId(knockoutTournamentId);
  const code = String(sourceTeam.code || '').trim().toUpperCase();
  let existing = await Team.findOne({
    tournamentId: tid,
    sourceTeamId: sourceTeam._id,
    isPlaceholder: { $ne: true },
  });
  if (!existing) {
    existing = await Team.findOne({
      tournamentId: tid,
      name: sourceTeam.name,
      isPlaceholder: { $ne: true },
    });
  }
  if (existing) {
    let dirty = false;
    if (code && existing.code !== code) {
      existing.code = code;
      dirty = true;
    }
    if (!existing.sourceTeamId) {
      existing.sourceTeamId = sourceTeam._id;
      dirty = true;
    }
    if (dirty) await existing.save();
    return existing._id;
  }
  const doc = await Team.create({
    tournamentId: tid,
    name: sourceTeam.name,
    code,
    sourceTeamId: sourceTeam._id,
  });
  return doc._id;
}

export function parseMatchFormat(raw) {
  const s = String(raw || '').trim();
  if (s === MATCH_FORMAT.BEST_OF_5 || s === MATCH_FORMAT.SINGLE_GAME || s === MATCH_FORMAT.BEST_OF_3) {
    return s;
  }
  return MATCH_FORMAT.BEST_OF_3;
}

/** 每輪內平均分配場地（場1、場2、場3、場1…）；BYE 完賽場次不佔場地 */
function makeCourtAssigner(slugs) {
  const list = (slugs || []).map((c) => String(c || '').trim()).filter(Boolean);
  let idx = 0;
  return {
    resetRound() {
      idx = 0;
    },
    next(skip = false) {
      if (skip || !list.length) return '';
      const court = list[idx % list.length];
      idx += 1;
      return court;
    },
  };
}

function resolveCourtSlugs(courts) {
  if (!Array.isArray(courts) || !courts.length) return [];
  if (typeof courts[0] === 'object') return venueSlugList(courts);
  return courts.map((c) => String(c || '').trim()).filter(Boolean);
}

/**
 * 以已在淘汰賽內的隊伍 ID 名單建立籤表場次（含 BYE／後續 TBD 占位）。
 * @param {{ matchFormat?: string, courts?: string[], timing?: object|null, scheduleDate?: string }} [options]
 * @returns {{ createdMatchIds: import('mongoose').Types.ObjectId[] }}
 */
async function createBracketFromTeamIds(koTournamentId, koTeamIds, options = {}) {
  const matchFormat = parseMatchFormat(options.matchFormat);
  const assignCourt = makeCourtAssigner(options.courts);
  const timing = options.timing || null;
  const timeAssign = createCourtTimeAssigner({
    startTime: timing?.startTime,
    startMinutes: timing?.startMinutes,
    slotMinutes: timing?.slotMinutes,
  });
  const scheduleDate = options.scheduleDate != null ? options.scheduleDate : '';
  const createdMatchIds = [];
  const bracketSize = nextPow2(koTeamIds.length);
  const byeTeamId = await ensurePlaceholderTeam(koTournamentId, 'BYE');
  const firstRoundLabel = roundLabelForSize(bracketSize);

  function courtAndTime(isBye = false) {
    const court = assignCourt.next(isBye);
    return {
      court,
      scheduledTime: timeAssign.next(court, { skip: isBye }),
      scheduledDate: scheduleDate,
    };
  }

  const seeds = new Array(bracketSize).fill(byeTeamId);
  for (let i = 0; i < koTeamIds.length; i++) {
    seeds[i] = koTeamIds[i];
  }
  const pairs = seedPairs(bracketSize);
  let sfIdx = 0;
  assignCourt.resetRound();
  for (const [s1, s2] of pairs) {
    const teamA = seeds[s1 - 1];
    const teamB = seeds[s2 - 1];
    const isBye = String(teamA) !== String(byeTeamId) && String(teamB) === String(byeTeamId);
    const isFourTeamSemi = koTeamIds.length === 4 && !isBye;

    const m = await Match.create({
      tournamentId: koTournamentId,
      round: isFourTeamSemi ? '準決賽' : firstRoundLabel,
      matchFormat,
      teamA,
      teamB,
      ...courtAndTime(isBye),
      status: isBye ? 'finished' : 'scheduled',
      completedGames: [],
      currentGameIndex: 0,
      currentPoints: { a: 0, b: 0 },
      winnerId: isBye ? teamA : undefined,
      ...(isFourTeamSemi
        ? {
            knockoutWinnerSlot: `W-SF${sfIdx + 1}`,
            knockoutLoserSlot: `L-SF${sfIdx + 1}`,
          }
        : {}),
    });
    if (isFourTeamSemi) sfIdx += 1;
    createdMatchIds.push(m._id);
  }

  // 4 隊：準決賽 → 決賽 + 季軍賽
  if (koTeamIds.length === 4) {
    const w1 = await ensurePlaceholderTeam(koTournamentId, 'W-SF1');
    const w2 = await ensurePlaceholderTeam(koTournamentId, 'W-SF2');
    const l1 = await ensurePlaceholderTeam(koTournamentId, 'L-SF1');
    const l2 = await ensurePlaceholderTeam(koTournamentId, 'L-SF2');

    assignCourt.resetRound();
    const finalM = await Match.create({
      tournamentId: koTournamentId,
      round: '決賽',
      matchFormat,
      teamA: w1,
      teamB: w2,
      ...courtAndTime(),
      status: 'scheduled',
      completedGames: [],
      currentGameIndex: 0,
      currentPoints: { a: 0, b: 0 },
    });
    const bronzeM = await Match.create({
      tournamentId: koTournamentId,
      round: '季軍賽',
      matchFormat,
      teamA: l1,
      teamB: l2,
      ...courtAndTime(),
      status: 'scheduled',
      completedGames: [],
      currentGameIndex: 0,
      currentPoints: { a: 0, b: 0 },
    });
    createdMatchIds.push(finalM._id, bronzeM._id);
  } else if (koTeamIds.length > 2) {
    // 其他規模：後續輪次 TBD 占位（無季軍賽）
    let size = bracketSize / 2;
    while (size >= 2) {
      const label = roundLabelForSize(size);
      assignCourt.resetRound();
      for (let i = 0; i < size / 2; i++) {
        const t1 = await ensurePlaceholderTeam(koTournamentId, `TBD-${label}-${i * 2 + 1}`);
        const t2 = await ensurePlaceholderTeam(koTournamentId, `TBD-${label}-${i * 2 + 2}`);
        const m = await Match.create({
          tournamentId: koTournamentId,
          round: label,
          matchFormat,
          teamA: t1,
          teamB: t2,
          ...courtAndTime(),
          status: 'scheduled',
          completedGames: [],
          currentGameIndex: 0,
          currentPoints: { a: 0, b: 0 },
        });
        createdMatchIds.push(m._id);
      }
      size = size / 2;
    }
  }

  return { createdMatchIds };
}

/**
 * 純淘汰賽：直接用本賽事已建立／匯入的隊伍產生鬼腳籤表（無需小組賽）。
 */
export async function generateKnockoutFromTeams({ knockoutTournamentId, matchFormat, courts, timing = null }) {
  if (!mongoose.isValidObjectId(knockoutTournamentId)) {
    return { ok: false, error: 'invalid_id' };
  }

  const ko = await Tournament.findById(knockoutTournamentId).lean();
  if (!ko) return { ok: false, error: 'not_found' };
  if (ko.phase !== 'knockout') return { ok: false, error: 'target_not_knockout' };

  const existingMatchCount = await Match.countDocuments({ tournamentId: ko._id });
  if (existingMatchCount > 0) return { ok: false, error: 'target_has_matches' };

  const teams = await Team.find({
    tournamentId: ko._id,
    isPlaceholder: { $ne: true },
  })
    .sort({ seed: 1, createdAt: 1 })
    .select('_id')
    .lean();

  if (teams.length < 2) return { ok: false, error: 'not_enough_teams' };

  let venueList = Array.isArray(courts) ? resolveCourtSlugs(courts) : null;
  if (!venueList) {
    const event = await Event.findById(ko.eventId).select('venues').lean();
    venueList = venueSlugList(event?.venues);
  }

  const koTeamIds = teams.map((t) => t._id);
  const scheduleDate = scheduleDateFromTournament(ko);
  const { createdMatchIds } = await createBracketFromTeamIds(ko._id, koTeamIds, {
    matchFormat,
    courts: venueList,
    timing,
    scheduleDate,
  });
  return {
    ok: true,
    createdTeams: koTeamIds.length,
    createdMatches: createdMatchIds.length,
    matchFormat: parseMatchFormat(matchFormat),
    courtsUsed: (venueList || []).length,
    timingApplied: !!(timing && timing.enabled !== false && (timing.startTime || timing.startMinutes != null)),
  };
}

/**
 * 由小組賽結果產生淘汰賽第一輪 + 後續 TBD 輪次。
 */
export async function generateKnockoutFromGroup({
  sourceTournamentId,
  knockoutTournamentId,
  advancePerGroup,
  timing = null,
  courts,
}) {
  if (!mongoose.isValidObjectId(sourceTournamentId) || !mongoose.isValidObjectId(knockoutTournamentId)) {
    return { ok: false, error: 'invalid_id' };
  }

  const src = await Tournament.findById(sourceTournamentId).lean();
  const ko = await Tournament.findById(knockoutTournamentId).lean();
  if (!src || !ko) return { ok: false, error: 'not_found' };
  if (src.phase !== 'group') return { ok: false, error: 'source_not_group' };
  if (ko.phase !== 'knockout') return { ok: false, error: 'target_not_knockout' };
  if (String(src.eventId) !== String(ko.eventId)) return { ok: false, error: 'different_event' };

  await Tournament.updateOne(
    { _id: knockoutTournamentId },
    {
      $set: {
        sourceGroupTournamentId: sourceTournamentId,
        ...(src.competitionDate
          ? { competitionDate: String(src.competitionDate).trim() }
          : {}),
      },
    }
  );

  const existingMatchCount = await Match.countDocuments({ tournamentId: ko._id });

  const groups = await Group.find({ tournamentId: src._id }).sort({ order: 1, createdAt: 1 }).lean();
  if (!groups.length) return { ok: false, error: 'no_groups' };

  const finishedGroupMatches = await Match.countDocuments({
    tournamentId: src._id,
    status: 'finished',
  });
  if (finishedGroupMatches === 0) {
    // 未打完小組唔好用假排名填真隊；請先用預排 A1/B2 籤表
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

  // Seed order: group order then rank in group
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

  const koTeamIds = [];
  for (const q of qualifiers) {
    const t = srcById.get(String(q.sourceTeamId));
    if (!t) continue;
    const koTeamId = await ensureTeamInTournament(ko._id, t);
    koTeamIds.push(koTeamId);
  }

  // 情況 2：淘汰賽已事先排好場次（用 A1/B2… slot + 已設定時間/場地/輪次）
  // 這裡只把 A1/B2… 置換成實際出線隊伍，不會新增/改動場次時間與場地。
  if (existingMatchCount > 0) {
    const slotToTeamId = {};
    // slot 定義：依「組別建立順序」映射為 A/B/C...，再加上名次數字 1..N
    for (let gi = 0; gi < groups.length; gi++) {
      const letter = letterForIndex(gi);
      for (let r = 1; r <= takeN; r++) {
        const q = qualifiers.find(
          (x) => String(x.groupId) === String(groups[gi]._id) && x.rankInGroup === r
        );
        if (!q) continue;
        const idx = qualifiers.indexOf(q);
        if (idx >= 0 && koTeamIds[idx]) {
          slotToTeamId[`${letter}${r}`] = koTeamIds[idx];
        }
      }
    }
    const filledIds = await fillKnockoutSlots(ko._id, slotToTeamId);
    return { ok: true, createdTeams: koTeamIds.length, createdMatches: 0, updatedMatches: filledIds.length };
  }

  // === Cross pairing（A1 對 B2、A2 對 B1 ...）===
  // 只在「出線隊數剛好為 2^k」且「組數為偶數」時使用；
  // 若需 BYE（出線隊數非 2^k）或組數為奇數，則退回種子＋BYE 的方式。
  const canCross =
    isPow2(koTeamIds.length) && groups.length % 2 === 0 && koTeamIds.length === qualifiers.length;

  let venueList = Array.isArray(courts) ? resolveCourtSlugs(courts) : null;
  if (!venueList) {
    const event = await Event.findById(ko.eventId).select('venues').lean();
    venueList = venueSlugList(event?.venues);
  }
  const scheduleDate = scheduleDateFromTournament(ko);
  const bracketOpts = { matchFormat: MATCH_FORMAT.BEST_OF_3, courts: venueList, timing, scheduleDate };

  const createdMatchIds = [];

  if (canCross) {
    // Build map groupId -> [koTeamId rank1..N]
    const byGroup = new Map();
    for (let i = 0; i < qualifiers.length; i++) {
      const q = qualifiers[i];
      const gid = String(q.groupId);
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid).push({ rank: q.rankInGroup, koTeamId: koTeamIds[i] });
    }
    for (const arr of byGroup.values()) {
      arr.sort((a, b) => a.rank - b.rank);
    }

    const firstRoundLabel = roundLabelForSize(nextPow2(koTeamIds.length));
    const assignCourt = makeCourtAssigner(venueList);
    const timeAssign = createCourtTimeAssigner({
      startTime: timing?.startTime,
      startMinutes: timing?.startMinutes,
      slotMinutes: timing?.slotMinutes,
    });
    function courtAndTime() {
      const court = assignCourt.next();
      return {
        court,
        scheduledTime: timeAssign.next(court),
        scheduledDate: scheduleDate,
      };
    }

    assignCourt.resetRound();
    for (let gi = 0; gi < groups.length; gi += 2) {
      const g1 = groups[gi];
      const g2 = groups[gi + 1];
      const r1 = byGroup.get(String(g1._id)) || [];
      const r2 = byGroup.get(String(g2._id)) || [];
      if (r1.length < takeN || r2.length < takeN) {
        break;
      }
      for (let i = 0; i < takeN; i++) {
        const teamA = r1[i].koTeamId;
        const teamB = r2[takeN - 1 - i].koTeamId;
        const sfIndex = createdMatchIds.length;
        const m = await Match.create({
          tournamentId: ko._id,
          round: koTeamIds.length === 4 ? '準決賽' : firstRoundLabel,
          matchFormat: MATCH_FORMAT.BEST_OF_3,
          teamA,
          teamB,
          ...courtAndTime(),
          status: 'scheduled',
          completedGames: [],
          currentGameIndex: 0,
          currentPoints: { a: 0, b: 0 },
          ...(koTeamIds.length === 4
            ? {
                knockoutWinnerSlot: `W-SF${sfIndex + 1}`,
                knockoutLoserSlot: `L-SF${sfIndex + 1}`,
              }
            : {}),
        });
        createdMatchIds.push(m._id);
      }
    }

    if (createdMatchIds.length === koTeamIds.length / 2) {
      if (koTeamIds.length === 4) {
        const w1 = await ensurePlaceholderTeam(ko._id, 'W-SF1');
        const w2 = await ensurePlaceholderTeam(ko._id, 'W-SF2');
        const l1 = await ensurePlaceholderTeam(ko._id, 'L-SF1');
        const l2 = await ensurePlaceholderTeam(ko._id, 'L-SF2');
        assignCourt.resetRound();
        const finalM = await Match.create({
          tournamentId: ko._id,
          round: '決賽',
          matchFormat: MATCH_FORMAT.BEST_OF_3,
          teamA: w1,
          teamB: w2,
          ...courtAndTime(),
          status: 'scheduled',
          completedGames: [],
          currentGameIndex: 0,
          currentPoints: { a: 0, b: 0 },
        });
        const bronzeM = await Match.create({
          tournamentId: ko._id,
          round: '季軍賽',
          matchFormat: MATCH_FORMAT.BEST_OF_3,
          teamA: l1,
          teamB: l2,
          ...courtAndTime(),
          status: 'scheduled',
          completedGames: [],
          currentGameIndex: 0,
          currentPoints: { a: 0, b: 0 },
        });
        createdMatchIds.push(finalM._id, bronzeM._id);
      } else if (koTeamIds.length > 2) {
        let size = nextPow2(koTeamIds.length) / 2;
        while (size >= 2) {
          const label = roundLabelForSize(size);
          assignCourt.resetRound();
          for (let i = 0; i < size / 2; i++) {
            const t1 = await ensurePlaceholderTeam(ko._id, `TBD-${label}-${i * 2 + 1}`);
            const t2 = await ensurePlaceholderTeam(ko._id, `TBD-${label}-${i * 2 + 2}`);
            const m = await Match.create({
              tournamentId: ko._id,
              round: label,
              matchFormat: MATCH_FORMAT.BEST_OF_3,
              teamA: t1,
              teamB: t2,
              ...courtAndTime(),
              status: 'scheduled',
              completedGames: [],
              currentGameIndex: 0,
              currentPoints: { a: 0, b: 0 },
            });
            createdMatchIds.push(m._id);
          }
          size = size / 2;
        }
      }
      return { ok: true, createdTeams: koTeamIds.length, createdMatches: createdMatchIds.length };
    }

    await Match.deleteMany({ _id: { $in: createdMatchIds } });
  }

  const { createdMatchIds: ids } = await createBracketFromTeamIds(ko._id, koTeamIds, bracketOpts);
  return { ok: true, createdTeams: koTeamIds.length, createdMatches: ids.length };
}

/**
 * 預排淘汰籤表：用 A1／B2… 占位（唔使小組出線結果），方便提早排時間／場地。
 * 小組打完後再呼叫 generateKnockoutFromGroup，會只填入真隊、唔改時間場地。
 */
export async function generateKnockoutSlotBracket({
  knockoutTournamentId,
  sourceTournamentId,
  advancePerGroup,
  matchFormat,
  courts,
  timing = null,
}) {
  if (!mongoose.isValidObjectId(knockoutTournamentId) || !mongoose.isValidObjectId(sourceTournamentId)) {
    return { ok: false, error: 'invalid_id' };
  }

  const ko = await Tournament.findById(knockoutTournamentId).lean();
  const src = await Tournament.findById(sourceTournamentId).lean();
  if (!src || !ko) return { ok: false, error: 'not_found' };
  if (src.phase !== 'group') return { ok: false, error: 'source_not_group' };
  if (ko.phase !== 'knockout') return { ok: false, error: 'target_not_knockout' };
  if (String(src.eventId) !== String(ko.eventId)) return { ok: false, error: 'different_event' };

  const existingMatchCount = await Match.countDocuments({ tournamentId: ko._id });
  if (existingMatchCount > 0) return { ok: false, error: 'target_has_matches' };

  const groups = await Group.find({ tournamentId: src._id }).sort({ order: 1, createdAt: 1 }).lean();
  if (!groups.length) return { ok: false, error: 'no_groups' };

  const takeN = Math.max(1, parseInt(advancePerGroup ?? src.advancePerGroup ?? 2, 10) || 2);
  const slotCount = groups.length * takeN;
  if (slotCount < 2) return { ok: false, error: 'not_enough_qualifiers' };

  await Tournament.updateOne(
    { _id: knockoutTournamentId },
    {
      $set: {
        sourceGroupTournamentId: sourceTournamentId,
        ...(src.competitionDate ? { competitionDate: String(src.competitionDate).trim() } : {}),
      },
    }
  );

  /** @type {string[]} 組序＋名次：A1,A2,…,B1,B2,… */
  const slots = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const letter = letterForIndex(gi);
    for (let r = 1; r <= takeN; r++) slots.push(`${letter}${r}`);
  }

  let venueList = Array.isArray(courts) ? resolveCourtSlugs(courts) : null;
  if (!venueList) {
    const event = await Event.findById(ko.eventId).select('venues').lean();
    venueList = venueSlugList(event?.venues);
  }
  const scheduleDate = scheduleDateFromTournament(ko) || scheduleDateFromTournament(src);
  const fmt = parseMatchFormat(matchFormat);
  const bracketOpts = { matchFormat: fmt, courts: venueList, timing, scheduleDate };

  const canCross = isPow2(slotCount) && groups.length % 2 === 0;

  if (canCross) {
    const assignCourt = makeCourtAssigner(venueList);
    const timeAssign = createCourtTimeAssigner({
      startTime: timing?.startTime,
      startMinutes: timing?.startMinutes,
      slotMinutes: timing?.slotMinutes,
    });
    function courtAndTime() {
      const court = assignCourt.next();
      return {
        court,
        scheduledTime: timeAssign.next(court),
        scheduledDate: scheduleDate,
      };
    }

    const createdMatchIds = [];
    const firstRoundLabel = roundLabelForSize(nextPow2(slotCount));
    assignCourt.resetRound();

    for (let gi = 0; gi < groups.length; gi += 2) {
      const letterA = letterForIndex(gi);
      const letterB = letterForIndex(gi + 1);
      for (let i = 0; i < takeN; i++) {
        const slotA = `${letterA}${i + 1}`;
        const slotB = `${letterB}${takeN - i}`;
        const teamA = await ensurePlaceholderTeam(ko._id, slotA);
        const teamB = await ensurePlaceholderTeam(ko._id, slotB);
        const sfIndex = createdMatchIds.length;
        const m = await Match.create({
          tournamentId: ko._id,
          round: slotCount === 4 ? '準決賽' : firstRoundLabel,
          matchFormat: fmt,
          teamA,
          teamB,
          ...courtAndTime(),
          status: 'scheduled',
          completedGames: [],
          currentGameIndex: 0,
          currentPoints: { a: 0, b: 0 },
          ...(slotCount === 4
            ? {
                knockoutWinnerSlot: `W-SF${sfIndex + 1}`,
                knockoutLoserSlot: `L-SF${sfIndex + 1}`,
              }
            : {}),
        });
        createdMatchIds.push(m._id);
      }
    }

    if (createdMatchIds.length !== slotCount / 2) {
      await Match.deleteMany({ _id: { $in: createdMatchIds } });
      // fall through to seed bracket
    } else if (slotCount === 4) {
      const w1 = await ensurePlaceholderTeam(ko._id, 'W-SF1');
      const w2 = await ensurePlaceholderTeam(ko._id, 'W-SF2');
      const l1 = await ensurePlaceholderTeam(ko._id, 'L-SF1');
      const l2 = await ensurePlaceholderTeam(ko._id, 'L-SF2');
      assignCourt.resetRound();
      const finalM = await Match.create({
        tournamentId: ko._id,
        round: '決賽',
        matchFormat: fmt,
        teamA: w1,
        teamB: w2,
        ...courtAndTime(),
        status: 'scheduled',
        completedGames: [],
        currentGameIndex: 0,
        currentPoints: { a: 0, b: 0 },
      });
      const bronzeM = await Match.create({
        tournamentId: ko._id,
        round: '季軍賽',
        matchFormat: fmt,
        teamA: l1,
        teamB: l2,
        ...courtAndTime(),
        status: 'scheduled',
        completedGames: [],
        currentGameIndex: 0,
        currentPoints: { a: 0, b: 0 },
      });
      createdMatchIds.push(finalM._id, bronzeM._id);
      return {
        ok: true,
        createdTeams: slotCount,
        createdMatches: createdMatchIds.length,
        slots,
        matchFormat: fmt,
        courtsUsed: (venueList || []).length,
        preseed: true,
      };
    } else if (slotCount > 2) {
      let size = nextPow2(slotCount) / 2;
      while (size >= 2) {
        const label = roundLabelForSize(size);
        assignCourt.resetRound();
        for (let i = 0; i < size / 2; i++) {
          const t1 = await ensurePlaceholderTeam(ko._id, `TBD-${label}-${i * 2 + 1}`);
          const t2 = await ensurePlaceholderTeam(ko._id, `TBD-${label}-${i * 2 + 2}`);
          const m = await Match.create({
            tournamentId: ko._id,
            round: label,
            matchFormat: fmt,
            teamA: t1,
            teamB: t2,
            ...courtAndTime(),
            status: 'scheduled',
            completedGames: [],
            currentGameIndex: 0,
            currentPoints: { a: 0, b: 0 },
          });
          createdMatchIds.push(m._id);
        }
        size = size / 2;
      }
      return {
        ok: true,
        createdTeams: slotCount,
        createdMatches: createdMatchIds.length,
        slots,
        matchFormat: fmt,
        courtsUsed: (venueList || []).length,
        preseed: true,
      };
    } else {
      // slotCount === 2：只有決賽
      return {
        ok: true,
        createdTeams: slotCount,
        createdMatches: createdMatchIds.length,
        slots,
        matchFormat: fmt,
        courtsUsed: (venueList || []).length,
        preseed: true,
      };
    }
  }

  const slotTeamIds = [];
  for (const name of slots) {
    slotTeamIds.push(await ensurePlaceholderTeam(ko._id, name));
  }
  const { createdMatchIds } = await createBracketFromTeamIds(ko._id, slotTeamIds, bracketOpts);
  return {
    ok: true,
    createdTeams: slots.length,
    createdMatches: createdMatchIds.length,
    slots,
    matchFormat: fmt,
    courtsUsed: (venueList || []).length,
    preseed: true,
  };
}

