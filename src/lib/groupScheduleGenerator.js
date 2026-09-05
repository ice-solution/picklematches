import mongoose from 'mongoose';
import { Tournament } from '../models/Tournament.js';
import { Team } from '../models/Team.js';
import { Group } from '../models/Group.js';
import { Match, MATCH_FORMAT } from '../models/Match.js';
import { Event } from '../models/Event.js';
import { parseMatchFormat } from './knockoutGenerator.js';
import { venueSlugList } from './venues.js';

function sortTeamsInGroup(teams) {
  return [...teams].sort((a, b) => {
    const ca = String(a.code || '').trim();
    const cb = String(b.code || '').trim();
    if (ca && cb && ca !== cb) return ca.localeCompare(cb, 'en', { numeric: true });
    if (ca && !cb) return -1;
    if (!ca && cb) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
  });
}

/**
 * Circle method：回傳每輪對戰 [[teamId, teamId], ...]
 * 奇數隊會自動跳過 BYE（唔建立場次）。
 */
export function buildRoundRobinRounds(teamIds) {
  const ids = teamIds.map((id) => String(id)).filter(Boolean);
  if (ids.length < 2) return [];

  const hasBye = ids.length % 2 === 1;
  const arr = hasBye ? [...ids, null] : [...ids];
  const n = arr.length;
  const rounds = [];

  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a && b) pairs.push([a, b]);
    }
    rounds.push(pairs);
    // 固定首位，其餘順時針轉
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return rounds;
}

function makeCourtAssigner(slugs) {
  const list = (slugs || []).map((c) => String(c || '').trim()).filter(Boolean);
  let idx = 0;
  return {
    resetRound() {
      idx = 0;
    },
    next() {
      if (!list.length) return '';
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
 * 小組賽：各組內單循環，一鍵產生全部場次。
 * 同「輪次」跨組一齊排，方便同輪平均分配場地。
 */
export async function generateGroupRoundRobin({ tournamentId, matchFormat, courts }) {
  if (!mongoose.isValidObjectId(tournamentId)) {
    return { ok: false, error: 'invalid_id' };
  }

  const tournament = await Tournament.findById(tournamentId).lean();
  if (!tournament) return { ok: false, error: 'not_found' };
  if (tournament.phase !== 'group') return { ok: false, error: 'target_not_group' };

  const existingMatchCount = await Match.countDocuments({ tournamentId });
  if (existingMatchCount > 0) return { ok: false, error: 'target_has_matches' };

  const groups = await Group.find({ tournamentId }).sort({ order: 1, createdAt: 1 }).lean();
  if (!groups.length) return { ok: false, error: 'no_groups' };

  const teams = await Team.find({
    tournamentId,
    isPlaceholder: { $ne: true },
  })
    .select('_id name code groupId')
    .lean();

  const groupPlans = [];
  for (const g of groups) {
    const gid = String(g._id);
    const gTeams = sortTeamsInGroup(teams.filter((t) => t.groupId && String(t.groupId) === gid));
    if (gTeams.length < 2) continue;
    groupPlans.push({
      group: g,
      teams: gTeams,
      rounds: buildRoundRobinRounds(gTeams.map((t) => t._id)),
    });
  }

  if (!groupPlans.length) return { ok: false, error: 'not_enough_teams' };

  let venueList = Array.isArray(courts) ? resolveCourtSlugs(courts) : null;
  if (!venueList) {
    const event = await Event.findById(tournament.eventId).select('venues').lean();
    venueList = venueSlugList(event?.venues);
  }

  const fmt = parseMatchFormat(matchFormat);
  const assignCourt = makeCourtAssigner(venueList);
  const maxRounds = Math.max(...groupPlans.map((p) => p.rounds.length));
  const createdMatchIds = [];

  for (let r = 0; r < maxRounds; r++) {
    assignCourt.resetRound();
    const roundLabel = `第${r + 1}輪`;
    for (const plan of groupPlans) {
      const pairs = plan.rounds[r] || [];
      for (const [teamA, teamB] of pairs) {
        const m = await Match.create({
          tournamentId,
          groupId: plan.group._id,
          round: roundLabel,
          matchFormat: fmt,
          teamA,
          teamB,
          court: assignCourt.next(),
          scheduledTime: '',
          status: 'scheduled',
          completedGames: [],
          currentGameIndex: 0,
          currentPoints: { a: 0, b: 0 },
        });
        createdMatchIds.push(m._id);
      }
    }
  }

  return {
    ok: true,
    createdTeams: groupPlans.reduce((n, p) => n + p.teams.length, 0),
    createdMatches: createdMatchIds.length,
    groupsUsed: groupPlans.length,
    rounds: maxRounds,
    matchFormat: fmt,
    courtsUsed: (venueList || []).length,
  };
}

export { MATCH_FORMAT };
