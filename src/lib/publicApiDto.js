import { normalizeEventVenues } from './venues.js';
import { scoreDisplayParts, enrichMatchesForSchedule } from './viewHelpers.js';
import { matchScheduleDate, displayMatchTime, displayMatchSchedule } from './matchTime.js';
import { normalizeDateOnly } from './datetime.js';
import { resolveGamePlayers, resolveCurrentPlayers, getSideLineup } from './leagueLineup.js';
import { LEAGUE_GAME_LABELS, isLeagueFormat } from './leagueRules.js';
import { venueLabel } from './venues.js';

function idOf(v) {
  if (!v) return null;
  if (typeof v === 'object' && v._id) return String(v._id);
  return String(v);
}

export function serializeTeam(team) {
  if (!team) return null;
  return {
    id: idOf(team),
    name: team.name || '',
    code: team.code || '',
    groupId: team.groupId ? String(team.groupId) : null,
    players: Array.isArray(team.players)
      ? team.players.map((p) => (typeof p === 'string' ? p : p?.name)).filter(Boolean)
      : [],
  };
}

export function serializeVenuePublic(v) {
  if (!v) return null;
  return {
    slug: v.slug || '',
    name: v.name || '',
  };
}

export function serializeEvent(event, { baseUrl = '' } = {}) {
  if (!event) return null;
  const venues = normalizeEventVenues(event.venues).map(serializeVenuePublic);
  const slug = event.slug || '';
  return {
    id: String(event._id),
    name: event.name || '',
    slug,
    description: event.description || '',
    coverImageUrl: event.coverImageUrl || '',
    dateStart: event.dateStart || null,
    dateEnd: event.dateEnd || null,
    venues,
    registrationEnabled: !!event.registrationEnabled,
    registrationInfo: event.registrationInfo || '',
    venueDetails: event.venueDetails || '',
    eligibilityNotes: event.eligibilityNotes || '',
    urls: {
      page: slug ? `/e/${slug}` : '',
      api: slug ? `/api/events/${encodeURIComponent(slug)}` : '',
      absolutePage: baseUrl && slug ? `${baseUrl}/e/${slug}` : '',
    },
  };
}

export function serializeTournament(t) {
  if (!t) return null;
  return {
    id: String(t._id),
    name: t.name || '',
    phase: t.phase || '',
    competitionDate: normalizeDateOnly(t.competitionDate) || '',
    advancePerGroup: t.phase === 'group' ? Math.max(1, t.advancePerGroup ?? 2) : null,
    order: t.order ?? 0,
  };
}

function serializeLineupSide(match, side) {
  const block = getSideLineup(match, side);
  if (!block?.confirmed) return { confirmed: false, games: [] };
  return {
    confirmed: true,
    confirmedAt: block.confirmedAt || null,
    games: (block.games || []).map((g, i) => ({
      index: i,
      label: g.label || LEAGUE_GAME_LABELS[i] || `第${i + 1}場`,
      players: g.players || [],
    })),
  };
}

function serializeCompletedGames(match) {
  const completed = Array.isArray(match?.completedGames) ? match.completedGames : [];
  const out = completed.map((g, i) => {
    const players = resolveGamePlayers(match, i, g);
    return {
      index: i,
      label: g.label || (isLeagueFormat(match.matchFormat) ? LEAGUE_GAME_LABELS[i] : `第${i + 1}局`),
      scoreA: Number(g.a || 0),
      scoreB: Number(g.b || 0),
      playersA: players.playersA,
      playersB: players.playersB,
      remark: g.remark || '',
    };
  });
  if (isLeagueFormat(match.matchFormat) && out.length < LEAGUE_GAME_LABELS.length) {
    for (let i = out.length; i < LEAGUE_GAME_LABELS.length; i++) {
      const players = resolveGamePlayers(match, i, null);
      if (!players.playersA.length && !players.playersB.length) continue;
      out.push({
        index: i,
        label: LEAGUE_GAME_LABELS[i],
        scoreA: null,
        scoreB: null,
        playersA: players.playersA,
        playersB: players.playersB,
        remark: '',
      });
    }
  }
  return out;
}

export function serializeMatch(match, { event = null, tournament = null } = {}) {
  if (!match) return null;
  const eventSlug = event?.slug || '';
  const court = String(match.court || '').trim();
  const score = scoreDisplayParts(match);
  const scheduleDate = matchScheduleDate({
    scheduledDate: match.scheduledDate,
    competitionDate: tournament?.competitionDate || match.competitionDate || '',
  });
  const currentPlayers = isLeagueFormat(match.matchFormat) ? resolveCurrentPlayers(match) : { playersA: [], playersB: [] };
  const currentIdx = Array.isArray(match.completedGames) ? match.completedGames.length : 0;

  return {
    id: String(match._id),
    tournamentId: idOf(match.tournamentId),
    tournamentName: match.tournamentName || tournament?.name || '',
    tournamentPhase: match.tournamentPhase || tournament?.phase || '',
    groupId: match.groupId ? String(match.groupId) : null,
    groupName: match.groupName || '',
    round: match.round || '',
    scheduleGroupLabel: match.scheduleGroupLabel || match.groupName || match.round || '',
    matchFormat: match.matchFormat || '',
    status: match.status || 'scheduled',
    court,
    courtLabel: event && court ? venueLabel(event.venues, court) : court,
    scheduledDate: scheduleDate,
    scheduledTime: match.scheduledTime || '',
    scheduleDisplay: displayMatchSchedule({
      scheduledDate: match.scheduledDate,
      scheduledTime: match.scheduledTime,
      competitionDate: tournament?.competitionDate || match.competitionDate || '',
    }),
    timeDisplay: displayMatchTime(match),
    teamA: serializeTeam(match.teamA),
    teamB: serializeTeam(match.teamB),
    winnerId: match.winnerId ? idOf(match.winnerId) : null,
    currentPoints: {
      a: Number(match.currentPoints?.a ?? 0),
      b: Number(match.currentPoints?.b ?? 0),
    },
    serving: match.serving || '',
    score: {
      main: score.main,
      detail: score.detail,
    },
    games: serializeCompletedGames(match),
    currentRound: isLeagueFormat(match.matchFormat)
      ? {
          index: currentIdx,
          label: LEAGUE_GAME_LABELS[currentIdx] || null,
          playersA: currentPlayers.playersA,
          playersB: currentPlayers.playersB,
        }
      : null,
    lineup: isLeagueFormat(match.matchFormat)
      ? {
          a: serializeLineupSide(match, 'a'),
          b: serializeLineupSide(match, 'b'),
        }
      : null,
    remark: match.remark || '',
    urls: {
      live: eventSlug && court ? `/e/${eventSlug}/court/${encodeURIComponent(court)}/live` : null,
      screen: eventSlug ? `/e/${eventSlug}/screen/${match._id}` : null,
      api: `/api/matches/${match._id}`,
    },
  };
}

export function serializeGroupStandingsBlock(block) {
  return {
    tournament: serializeTournament(block.tournament),
    advancePerGroup: block.advancePerGroup,
    groups: (block.groups || []).map((g) => ({
      groupId: g.group?._id ? String(g.group._id) : g.groupId ? String(g.groupId) : null,
      groupName: g.group?.name || g.name || '',
      rows: (g.rows || []).map((r) => ({
        rank: r.rank ?? null,
        advances: !!r.advances,
        team: {
          id: r.teamId ? String(r.teamId) : idOf(r.team),
          name: r.name || r.team?.name || '',
          code: r.code || r.team?.code || '',
        },
        played: r.played ?? 0,
        wins: r.wins ?? 0,
        losses: r.losses ?? 0,
        points: r.points ?? 0,
        pointsFor: r.pointsFor ?? 0,
        pointsAgainst: r.pointsAgainst ?? 0,
        pointDiff: r.pointDiff ?? 0,
      })),
    })),
  };
}

export function serializeLeagueStandingsBlock(block) {
  return {
    tournament: serializeTournament(block.tournament),
    rows: (block.rows || []).map((r) => ({
      rank: r.rank ?? null,
      team: {
        id: r.teamId ? String(r.teamId) : idOf(r.team),
        name: r.name || r.team?.name || '',
        code: r.code || r.team?.code || '',
        players: Array.isArray(r.players) ? r.players : [],
      },
      played: r.played ?? 0,
      wins: r.wins ?? 0,
      losses: r.losses ?? 0,
      pointsFor: r.pointsFor ?? 0,
      pointsAgainst: r.pointsAgainst ?? 0,
      pointDiff: r.pointDiff ?? 0,
    })),
  };
}

export function enrichAndSerializeMatches(matches, { event, tournaments, groups }) {
  const enriched = enrichMatchesForSchedule(matches, tournaments, groups);
  const tMap = Object.fromEntries((tournaments || []).map((t) => [String(t._id), t]));
  return enriched.map((m) => serializeMatch(m, { event, tournament: tMap[String(m.tournamentId)] || null }));
}
