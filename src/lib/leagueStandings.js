import mongoose from 'mongoose';
import { Team } from '../models/Team.js';
import { Match } from '../models/Match.js';
import { Tournament } from '../models/Tournament.js';
import { inferMatchWinnerId, matchPointsTotals } from './matchResult.js';
import { rosterFromTeam } from './leagueRules.js';

function cmpNumDesc(a, b) {
  return (b ?? 0) - (a ?? 0);
}

/**
 * 聯賽榜：已完賽場次。排名先得失球，再贏場數。無和局。
 */
export async function computeLeagueStandings(tournamentId, { listedOnly = false } = {}) {
  const tid = new mongoose.Types.ObjectId(tournamentId);
  const teams = await Team.find({ tournamentId: tid, isPlaceholder: { $ne: true } })
    .select('_id name code checkedIn players')
    .sort({ code: 1, name: 1 })
    .lean();
  const teamById = new Map(teams.map((t) => [String(t._id), t]));

  const statsByTeamId = new Map();
  function statFor(teamId) {
    const key = String(teamId);
    if (!statsByTeamId.has(key)) {
      const t = teamById.get(key);
      statsByTeamId.set(key, {
        teamId: key,
        name: t?.name || '—',
        code: t?.code || '',
        checkedIn: !!t?.checkedIn,
        players: rosterFromTeam(t),
        played: 0,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDiff: 0,
      });
    }
    return statsByTeamId.get(key);
  }

  const matches = await Match.find({
    tournamentId: tid,
    status: 'finished',
    ...(listedOnly ? { showOnWebsite: { $ne: false } } : {}),
  })
    .select('teamA teamB winnerId completedGames status currentPoints matchFormat')
    .lean();

  for (const m of matches) {
    const aId = String(m.teamA);
    const bId = String(m.teamB);
    if (!teamById.has(aId) || !teamById.has(bId)) continue;

    const { ptsA, ptsB } = matchPointsTotals({ ...m, status: 'finished' });
    const wId = inferMatchWinnerId(m) || '';

    const sa = statFor(aId);
    const sb = statFor(bId);
    sa.played += 1;
    sb.played += 1;

    if (wId === aId) {
      sa.wins += 1;
      sb.losses += 1;
    } else if (wId === bId) {
      sb.wins += 1;
      sa.losses += 1;
    }

    sa.pointsFor += ptsA;
    sa.pointsAgainst += ptsB;
    sb.pointsFor += ptsB;
    sb.pointsAgainst += ptsA;
  }

  for (const t of teams) statFor(t._id);

  const rows = [...statsByTeamId.values()];
  for (const s of rows) {
    s.pointDiff = s.pointsFor - s.pointsAgainst;
  }
  rows.sort((x, y) => {
    if (x.pointDiff !== y.pointDiff) return cmpNumDesc(x.pointDiff, y.pointDiff);
    if (x.wins !== y.wins) return cmpNumDesc(x.wins, y.wins);
    if (x.pointsFor !== y.pointsFor) return cmpNumDesc(x.pointsFor, y.pointsFor);
    return String(x.name).localeCompare(String(y.name), 'zh-Hant');
  });
  rows.forEach((row, idx) => {
    row.rank = idx + 1;
  });
  return rows;
}

export async function getEventLeagueStandings(eventId, { listedOnly = false } = {}) {
  const eid = new mongoose.Types.ObjectId(eventId);
  const q = { eventId: eid, phase: 'league' };
  if (listedOnly) q.showOnWebsite = { $ne: false };
  const tournaments = await Tournament.find(q)
    .sort({ order: 1, createdAt: 1 })
    .lean();

  return Promise.all(
    tournaments.map(async (t) => ({
      tournament: t,
      rows: await computeLeagueStandings(t._id, { listedOnly }),
    }))
  );
}
