import { Match } from '../models/Match.js';
import { Tournament } from '../models/Tournament.js';
import { Event } from '../models/Event.js';
import { advanceKnockoutFromFinishedMatch } from './knockoutAdvance.js';
import { findLiveMatchOnCourt } from './courtLive.js';
import { findVenue, normalizeEventVenues } from './venues.js';

function courtRoom(eventId, venueSlug) {
  return `court:${eventId}:${venueSlug}`;
}

function resolveCourtVenue(event, match) {
  const venues = normalizeEventVenues(event.venues);
  return findVenue(venues, match.court) || null;
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

    const venue = resolveCourtVenue(evt, populated);
    if (venue) {
      const room = courtRoom(eid, venue.slug);
      if (populated.status === 'live') {
        io.to(room).emit('court:update', { match: populated });
      } else {
        // 非 live 更新唔好盲推 null：同場地可能仲有另一場 live
        let liveNow = null;
        try {
          liveNow = await findLiveMatchOnCourt(evt, venue.slug);
        } catch (err) {
          console.error('findLiveMatchOnCourt during broadcast failed:', err);
        }
        io.to(room).emit('court:update', {
          match: liveNow || null,
          lastMatch: populated,
        });
      }
    }
  }
  return populated;
}

export async function broadcastCourtIdle(app, eventId, venueSlug) {
  const io = app.get('io');
  if (!io || !eventId || !venueSlug) return;
  io.to(courtRoom(String(eventId), String(venueSlug))).emit('court:update', { match: null });
}
