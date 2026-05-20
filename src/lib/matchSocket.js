import { Match } from '../models/Match.js';
import { Tournament } from '../models/Tournament.js';
import { Event } from '../models/Event.js';

/** 比分更新後推播至 Socket.io（前台／大螢幕） */
export async function broadcastMatchUpdate(app, matchId) {
  const populated = await Match.findById(matchId).populate('teamA teamB winnerId').lean();
  if (!populated) return null;
  const tournament = await Tournament.findById(populated.tournamentId).lean();
  const evt = tournament ? await Event.findById(tournament.eventId).lean() : null;
  const io = app.get('io');
  if (io && evt) {
    const eid = evt._id.toString();
    const mid = populated._id.toString();
    io.to(`event:${eid}`).emit('match:update', { match: populated });
    io.to(`match:${mid}`).emit('match:update', { match: populated });
  }
  return populated;
}
