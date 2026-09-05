import { Match } from '../models/Match.js';
import { Tournament } from '../models/Tournament.js';
import { Event } from '../models/Event.js';
import { advanceKnockoutFromFinishedMatch } from './knockoutAdvance.js';
import { findVenue, normalizeEventVenues } from './venues.js';

function courtRoom(eventId, venueSlug) {
  return `court:${eventId}:${venueSlug}`;
}

function resolveCourtRooms(event, match) {
  const venues = normalizeEventVenues(event.venues);
  const venue = findVenue(venues, match.court);
  if (!venue) return [];
  return [courtRoom(String(event._id), venue.slug)];
}

/** 比分更新後推播至 Socket.io（前台／大螢幕／場地 Live） */
export async function broadcastMatchUpdate(app, matchId) {
  let advance = { matchIds: [] };
  try {
    advance = await advanceKnockoutFromFinishedMatch(matchId);
  } catch (err) {
    console.error('advanceKnockoutFromFinishedMatch failed:', err);
  }
  const populated = await Match.findById(matchId).populate('teamA teamB winnerId').lean();
  if (!populated) return null;
  const tournament = await Tournament.findById(populated.tournamentId).lean();
  const evt = tournament ? await Event.findById(tournament.eventId).lean() : null;
  const io = app.get('io');
  if (io && evt) {
    const eid = evt._id.toString();
    const mid = populated._id.toString();
    const eventMatches = [populated];
    io.to(`match:${mid}`).emit('match:update', { match: populated });
    for (const oid of advance.matchIds || []) {
      const m2 = await Match.findById(oid).populate('teamA teamB winnerId').lean();
      if (m2) {
        eventMatches.push(m2);
        const m2id = m2._id.toString();
        io.to(`match:${m2id}`).emit('match:update', { match: m2 });
      }
    }
    io.to(`event:${eid}`).emit('match:update', { matches: eventMatches });

    for (const room of resolveCourtRooms(evt, populated)) {
      const payload =
        populated.status === 'live'
          ? { match: populated }
          : { match: null, lastMatch: populated };
      io.to(room).emit('court:update', payload);
    }
  }
  return populated;
}

export async function broadcastCourtIdle(app, eventId, venueSlug) {
  const io = app.get('io');
  if (!io || !eventId || !venueSlug) return;
  io.to(courtRoom(String(eventId), String(venueSlug))).emit('court:update', { match: null });
}
