import { Router } from 'express';
import mongoose from 'mongoose';
import { MatchAssignment } from '../models/MatchAssignment.js';
import { Match } from '../models/Match.js';
import { addPointToCurrentGame } from '../lib/scoring.js';
import { broadcastMatchUpdate } from '../lib/matchSocket.js';
import { requireRefereeApi } from '../middleware/auth.js';

export const refereeApiRouter = Router();
refereeApiRouter.use(requireRefereeApi);

refereeApiRouter.post('/matches/:matchId/point', async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const side = req.body?.side;
    if (!mongoose.isValidObjectId(matchId)) {
      return res.status(400).json({ error: 'invalid_id' });
    }
    if (side !== 'a' && side !== 'b') {
      return res.status(400).json({ error: 'invalid_side' });
    }

    const uid = new mongoose.Types.ObjectId(req.session.userId);
    const assigned = await MatchAssignment.findOne({ refereeId: uid, matchId });
    if (!assigned) {
      return res.status(403).json({ error: 'not_assigned' });
    }

    const match = await Match.findById(matchId);
    if (!match) return res.status(404).json({ error: 'not_found' });

    const r = addPointToCurrentGame(match, side);
    if (!r.ok) {
      return res.status(400).json({ error: r.error });
    }

    await match.save();
    let populated = null;
    try {
      populated = await broadcastMatchUpdate(req.app, match._id);
    } catch (err) {
      console.error('broadcastMatchUpdate failed:', err);
      populated = await Match.findById(match._id).populate('teamA teamB winnerId').lean();
    }

    res.json({ ok: true, result: r, match: populated });
  } catch (e) {
    next(e);
  }
});
