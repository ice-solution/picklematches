import { Match } from '../models/Match.js';
import { Tournament } from '../models/Tournament.js';
import { Event } from '../models/Event.js';
import { courtMatchFilter, findVenue, normalizeEventVenues } from './venues.js';

export async function eventTournamentIds(eventId) {
  const list = await Tournament.find({ eventId }).select('_id').lean();
  return list.map((t) => t._id);
}

/** 該場地目前 live 場次（同一大會、同一場地同時只應有一場） */
export async function findLiveMatchOnCourt(event, venueSlug) {
  const venues = normalizeEventVenues(event.venues);
  const venue = findVenue(venues, venueSlug);
  if (!venue) return null;

  const tids = await eventTournamentIds(event._id);
  if (!tids.length) return null;

  return Match.findOne({
    tournamentId: { $in: tids },
    status: 'live',
    ...courtMatchFilter(venue),
  })
    .populate('teamA teamB winnerId')
    .lean();
}

/**
 * 將同場地其他 live 場次改回 scheduled（確保一場地同時只一場 live）
 */
export async function demoteOtherLiveOnCourt(match) {
  if (!match || match.status !== 'live') return [];
  const court = String(match.court || '').trim();
  if (!court) return [];

  const tournament = await Tournament.findById(match.tournamentId).lean();
  if (!tournament) return [];

  const event = await Event.findById(tournament.eventId).select('venues').lean();
  const venue = findVenue(event?.venues, court);
  const courtFilter = venue ? courtMatchFilter(venue) : { court };

  const tids = await eventTournamentIds(tournament.eventId);
  const others = await Match.find({
    tournamentId: { $in: tids },
    status: 'live',
    _id: { $ne: match._id },
    ...courtFilter,
  })
    .select('_id')
    .lean();
  if (!others.length) return [];

  await Match.updateMany({ _id: { $in: others.map((m) => m._id) } }, { $set: { status: 'scheduled' } });
  return others.map((m) => m._id);
}
