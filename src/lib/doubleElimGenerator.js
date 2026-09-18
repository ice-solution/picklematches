import mongoose from 'mongoose';
import { Tournament } from '../models/Tournament.js';
import { Team } from '../models/Team.js';
import { Match, MATCH_FORMAT } from '../models/Match.js';
import { Event } from '../models/Event.js';
import { venueSlugList } from './venues.js';

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
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
 */
export async function generateDoubleElimFromTeams({ tournamentId, matchFormat, courts }) {
  if (!mongoose.isValidObjectId(tournamentId)) return { ok: false, error: 'invalid_id' };

  const t = await Tournament.findById(tournamentId).lean();
  if (!t) return { ok: false, error: 'not_found' };
  if (t.phase !== 'double_elim') return { ok: false, error: 'target_not_double_elim' };

  const existingMatchCount = await Match.countDocuments({ tournamentId: t._id });
  if (existingMatchCount > 0) return { ok: false, error: 'target_has_matches' };

  const teams = await Team.find({
    tournamentId: t._id,
    isPlaceholder: { $ne: true },
  })
    .sort({ seed: 1, createdAt: 1 })
    .select('_id')
    .lean();

  if (teams.length < 2) return { ok: false, error: 'not_enough_teams' };

  let venueList = Array.isArray(courts) ? resolveCourtSlugs(courts) : null;
  if (!venueList) {
    const event = await Event.findById(t.eventId).select('venues').lean();
    venueList = venueSlugList(event?.venues);
  }

  const fmt = parseMatchFormat(matchFormat);
  const assignCourt = makeCourtAssigner(venueList);
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
        court: assignCourt.next(isBye),
        scheduledTime: '',
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
          court: assignCourt.next(),
          scheduledTime: '',
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
            court: assignCourt.next(),
            scheduledTime: '',
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
            court: assignCourt.next(),
            scheduledTime: '',
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
        court: assignCourt.next(),
        scheduledTime: '',
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
    court: assignCourt.next(),
    scheduledTime: '',
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
  const gf2 = await Match.create({
    tournamentId: t._id,
    round: '總決賽（若需要）',
    matchFormat: fmt,
    teamA: gf2A,
    teamB: gf2B,
    court: '',
    scheduledTime: '',
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
  const { fillKnockoutSlots } = await import('./knockoutGenerator.js');
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
  };
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
