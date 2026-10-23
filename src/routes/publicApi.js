import { Router } from 'express';
import mongoose from 'mongoose';
import { Event } from '../models/Event.js';
import { Tournament } from '../models/Tournament.js';
import { Match } from '../models/Match.js';
import { Group } from '../models/Group.js';
import { Team } from '../models/Team.js';
import { DisplayContent } from '../models/DisplayContent.js';
import { getEventGroupStandings } from '../lib/groupStandings.js';
import { getEventLeagueStandings } from '../lib/leagueStandings.js';
import { filterPublicMatches, filterPublicTournaments, isShowOnWebsite } from '../lib/publicListing.js';
import { normalizeDateOnly } from '../lib/datetime.js';
import { matchScheduleDate } from '../lib/matchTime.js';
import {
  serializeEvent,
  serializeTournament,
  serializeMatch,
  serializeTeam,
  serializeGroupStandingsBlock,
  serializeLeagueStandingsBlock,
  enrichAndSerializeMatches,
} from '../lib/publicApiDto.js';

export const publicApiRouter = Router();

function requestBaseUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  return host ? `${proto}://${host}` : '';
}

async function getActiveEventBySlug(slug) {
  const s = String(slug || '').toLowerCase().trim();
  if (!s) return null;
  const event = await Event.findOne({ $or: [{ slug: s }, { slugAliases: s }] }).lean();
  if (!event || !event.isActive) return null;
  return event;
}

async function loadPublicTournaments(eventId) {
  const all = await Tournament.find({ eventId }).sort({ order: 1, createdAt: 1 }).lean();
  return filterPublicTournaments(all);
}

/** GET /api — 目錄 */
publicApiRouter.get('/', (_req, res) => {
  res.json({
    name: '公開前台 API',
    version: 1,
    endpoints: {
      events: 'GET /api/events',
      event: 'GET /api/events/:slug',
      tournaments: 'GET /api/events/:slug/tournaments',
      matches: 'GET /api/events/:slug/matches?date=&tournamentId=&status=&court=',
      standings: 'GET /api/events/:slug/standings',
      teams: 'GET /api/events/:slug/teams?tournamentId=',
      display: 'GET /api/events/:slug/display',
      match: 'GET /api/matches/:id',
    },
    notes: [
      '只回傳已在網站公開的大會／賽事／場次（同前台）。',
      '亦可經 /api/public/... 存取相同路徑（相容舊用法）。',
      '聯賽場次 urls.live = /e/{slug}/court/{court}/live',
    ],
  });
});

/** 公開大會列表 */
publicApiRouter.get('/events', async (req, res, next) => {
  try {
    const events = await Event.find({ isActive: true }).sort({ dateStart: -1, createdAt: -1 }).lean();
    const baseUrl = requestBaseUrl(req);
    res.json({
      events: events.map((e) => serializeEvent(e, { baseUrl })),
    });
  } catch (e) {
    next(e);
  }
});

/** 單一大會 */
publicApiRouter.get('/events/:slug', async (req, res, next) => {
  try {
    const event = await getActiveEventBySlug(req.params.slug);
    if (!event) return res.status(404).json({ error: 'not_found' });
    const tournaments = await loadPublicTournaments(event._id);
    res.json({
      event: serializeEvent(event, { baseUrl: requestBaseUrl(req) }),
      tournaments: tournaments.map(serializeTournament),
    });
  } catch (e) {
    next(e);
  }
});

/** 賽事（小組／淘汰／聯賽） */
publicApiRouter.get('/events/:slug/tournaments', async (req, res, next) => {
  try {
    const event = await getActiveEventBySlug(req.params.slug);
    if (!event) return res.status(404).json({ error: 'not_found' });
    const tournaments = await loadPublicTournaments(event._id);
    res.json({
      event: { id: String(event._id), slug: event.slug, name: event.name },
      tournaments: tournaments.map(serializeTournament),
    });
  } catch (e) {
    next(e);
  }
});

/** 賽程／賽果（可篩選） */
publicApiRouter.get('/events/:slug/matches', async (req, res, next) => {
  try {
    const event = await getActiveEventBySlug(req.params.slug);
    if (!event) return res.status(404).json({ error: 'not_found' });

    const tournaments = await loadPublicTournaments(event._id);
    let tids = tournaments.map((t) => t._id);

    const tournamentId = String(req.query.tournamentId || '').trim();
    if (tournamentId) {
      if (!mongoose.isValidObjectId(tournamentId)) {
        return res.status(400).json({ error: 'invalid_tournament_id' });
      }
      const allowed = tids.some((id) => String(id) === tournamentId);
      if (!allowed) return res.status(404).json({ error: 'tournament_not_found' });
      tids = [new mongoose.Types.ObjectId(tournamentId)];
    }

    const groups = await Group.find({ tournamentId: { $in: tids } }).select('_id name tournamentId').lean();
    let matches = await Match.find({ tournamentId: { $in: tids }, showOnWebsite: { $ne: false } })
      .populate('teamA teamB winnerId')
      .sort({ scheduledDate: 1, scheduledTime: 1, createdAt: 1 })
      .lean();
    matches = filterPublicMatches(matches, tournaments);

    const date = normalizeDateOnly(req.query.date);
    if (date) {
      const tDate = Object.fromEntries(
        tournaments.map((t) => [String(t._id), normalizeDateOnly(t.competitionDate) || ''])
      );
      matches = matches.filter((m) => {
        const d = matchScheduleDate({
          scheduledDate: m.scheduledDate,
          competitionDate: tDate[String(m.tournamentId)] || '',
        });
        return d === date;
      });
    }

    const status = String(req.query.status || '').trim().toLowerCase();
    if (status) {
      matches = matches.filter((m) => String(m.status || '').toLowerCase() === status);
    }

    const court = String(req.query.court || '').trim().toLowerCase();
    if (court) {
      matches = matches.filter((m) => String(m.court || '').trim().toLowerCase() === court);
    }

    const items = enrichAndSerializeMatches(matches, { event, tournaments, groups });
    res.json({
      event: { id: String(event._id), slug: event.slug, name: event.name },
      count: items.length,
      matches: items,
    });
  } catch (e) {
    next(e);
  }
});

/** 積分榜（小組＋聯賽） */
publicApiRouter.get('/events/:slug/standings', async (req, res, next) => {
  try {
    const event = await getActiveEventBySlug(req.params.slug);
    if (!event) return res.status(404).json({ error: 'not_found' });

    const [groupBlocks, leagueBlocks] = await Promise.all([
      getEventGroupStandings(event._id, { listedOnly: true }),
      getEventLeagueStandings(event._id, { listedOnly: true }),
    ]);

    res.json({
      event: { id: String(event._id), slug: event.slug, name: event.name },
      group: groupBlocks.map(serializeGroupStandingsBlock),
      league: leagueBlocks.map(serializeLeagueStandingsBlock),
      /** 相容舊客戶端 */
      standings: groupBlocks,
    });
  } catch (e) {
    next(e);
  }
});

/** 隊伍 */
publicApiRouter.get('/events/:slug/teams', async (req, res, next) => {
  try {
    const event = await getActiveEventBySlug(req.params.slug);
    if (!event) return res.status(404).json({ error: 'not_found' });
    const tournaments = await loadPublicTournaments(event._id);
    let tids = tournaments.map((t) => t._id);

    const tournamentId = String(req.query.tournamentId || '').trim();
    if (tournamentId) {
      if (!mongoose.isValidObjectId(tournamentId)) {
        return res.status(400).json({ error: 'invalid_tournament_id' });
      }
      if (!tids.some((id) => String(id) === tournamentId)) {
        return res.status(404).json({ error: 'tournament_not_found' });
      }
      tids = [new mongoose.Types.ObjectId(tournamentId)];
    }

    const teams = await Team.find({ tournamentId: { $in: tids }, isPlaceholder: { $ne: true } })
      .select('_id name code groupId tournamentId players')
      .sort({ code: 1, name: 1 })
      .lean();

    res.json({
      event: { id: String(event._id), slug: event.slug, name: event.name },
      teams: teams.map((t) => ({
        ...serializeTeam(t),
        tournamentId: String(t.tournamentId),
      })),
    });
  } catch (e) {
    next(e);
  }
});

/** 顯示內容（舊大螢幕內容） */
publicApiRouter.get('/events/:slug/display', async (req, res, next) => {
  try {
    const event = await getActiveEventBySlug(req.params.slug);
    if (!event) return res.status(404).json({ error: 'not_found' });
    const items = await DisplayContent.find({ eventId: event._id, isPublished: true })
      .sort({ order: 1 })
      .lean();
    res.json({
      event: { id: String(event._id), slug: event.slug, name: event.name },
      items: items.map((it) => ({
        id: String(it._id),
        title: it.title || '',
        body: it.body || '',
        mediaUrl: it.mediaUrl || '',
        order: it.order ?? 0,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/** 單一場次 */
publicApiRouter.get('/matches/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'not_found' });
    const match = await Match.findById(id).populate('teamA teamB winnerId').lean();
    if (!match) return res.status(404).json({ error: 'not_found' });
    const tournament = await Tournament.findById(match.tournamentId).lean();
    if (!tournament || !isShowOnWebsite(tournament) || !isShowOnWebsite(match)) {
      return res.status(404).json({ error: 'not_found' });
    }
    const event = await Event.findById(tournament.eventId).lean();
    if (!event?.isActive) return res.status(404).json({ error: 'not_found' });

    const groups = match.groupId
      ? await Group.find({ _id: match.groupId }).select('_id name tournamentId').lean()
      : [];
    const [serialized] = enrichAndSerializeMatches([match], {
      event,
      tournaments: [tournament],
      groups,
    });
    res.json({
      event: serializeEvent(event, { baseUrl: requestBaseUrl(req) }),
      tournament: serializeTournament(tournament),
      match: serialized || serializeMatch(match, { event, tournament }),
    });
  } catch (e) {
    next(e);
  }
});
