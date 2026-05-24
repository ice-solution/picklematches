import { Router } from 'express';
import mongoose from 'mongoose';
import { Match } from '../models/Match.js';
import { Team } from '../models/Team.js';
import { addPointToCurrentGame } from '../lib/scoring.js';
import { broadcastMatchUpdate } from '../lib/matchSocket.js';
import { requireStaffApi } from '../middleware/auth.js';

export const adminApiRouter = Router();
adminApiRouter.use(requireStaffApi);

adminApiRouter.post('/matches/:matchId/point', async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const side = req.body?.side;
    if (!mongoose.isValidObjectId(matchId)) {
      return res.status(400).json({ error: 'invalid_id' });
    }
    if (side !== 'a' && side !== 'b') {
      return res.status(400).json({ error: 'invalid_side' });
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

adminApiRouter.post('/teams/:teamId/check-in', async (req, res, next) => {
  try {
    const { teamId } = req.params;
    if (!mongoose.isValidObjectId(teamId)) {
      return res.status(400).json({ error: 'invalid_id' });
    }

    const team = await Team.findById(teamId);
    if (!team || team.isPlaceholder) return res.status(404).json({ error: 'not_found' });

    const raw = req.body?.checkedIn;
    team.checkedIn = raw === true || raw === 'true' || raw === '1' || raw === 1;
    await team.save();

    res.json({ ok: true, checkedIn: team.checkedIn });
  } catch (e) {
    next(e);
  }
});
