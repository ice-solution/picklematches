import mongoose from 'mongoose';
import { Tournament } from '../models/Tournament.js';
import { Team } from '../models/Team.js';
import { Match, MATCH_FORMAT } from '../models/Match.js';
import { Event } from '../models/Event.js';
import { buildRoundRobinRounds } from './groupScheduleGenerator.js';
import { venueSlugList } from './venues.js';

function sortTeams(teams) {
  return [...teams].sort((a, b) => {
    const ca = String(a.code || '').trim();
    const cb = String(b.code || '').trim();
    if (ca && cb && ca !== cb) return ca.localeCompare(cb, 'en', { numeric: true });
    if (ca && !cb) return -1;
    if (!ca && cb) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
  });
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

/** 雙循環：先單循環，後半季主客對調 */
export function buildDoubleRoundRobinRounds(teamIds) {
  const first = buildRoundRobinRounds(teamIds);
  const second = first.map((pairs) => pairs.map(([a, b]) => [b, a]));
  return [...first, ...second];
}

function pairKey(a, b) {
  return `${String(a)}|${String(b)}`;
}

/**
 * 聯賽雙循環。fillMissing=true 時只補尚未出現嘅定向對賽（方便每週人手加場後再補齊）。
 */
export async function generateLeagueDoubleRoundRobin({ tournamentId, fillMissing = false }) {
  if (!mongoose.isValidObjectId(tournamentId)) {
    return { ok: false, error: 'invalid_id' };
  }

  const tournament = await Tournament.findById(tournamentId).lean();
  if (!tournament) return { ok: false, error: 'not_found' };
  if (tournament.phase !== 'league') return { ok: false, error: 'target_not_league' };

  const existing = await Match.find({ tournamentId }).select('teamA teamB').lean();
  if (existing.length && !fillMissing) {
    return { ok: false, error: 'target_has_matches' };
  }

  const teams = sortTeams(
    await Team.find({ tournamentId, isPlaceholder: { $ne: true } }).select('_id name code').lean()
  );
  if (teams.length < 2) return { ok: false, error: 'not_enough_teams' };

  const rounds = buildDoubleRoundRobinRounds(teams.map((t) => t._id));
  const existingPairs = new Set(existing.map((m) => pairKey(m.teamA, m.teamB)));

  const event = await Event.findById(tournament.eventId).select('venues').lean();
  const courts = resolveCourtSlugs(event?.venues);
  const assign = makeCourtAssigner(courts);

  const docs = [];
  rounds.forEach((pairs, r) => {
    assign.resetRound();
    for (const [a, b] of pairs) {
      if (fillMissing && existingPairs.has(pairKey(a, b))) continue;
      docs.push({
        tournamentId,
        round: `第${r + 1}輪`,
        matchFormat: MATCH_FORMAT.LEAGUE_FIVE,
        teamA: a,
        teamB: b,
        court: assign.next(),
        scheduledTime: '',
        status: 'scheduled',
        completedGames: [],
        currentGameIndex: 0,
        currentPoints: { a: 0, b: 0 },
      });
    }
  });

  if (!docs.length) {
    return { ok: true, createdMatches: 0, rounds: rounds.length, teams: teams.length, courtsUsed: courts.length, filled: true };
  }

  await Match.insertMany(docs);
  return {
    ok: true,
    createdMatches: docs.length,
    rounds: rounds.length,
    teams: teams.length,
    courtsUsed: courts.length,
    matchFormat: MATCH_FORMAT.LEAGUE_FIVE,
    filled: !!fillMissing,
  };
}
