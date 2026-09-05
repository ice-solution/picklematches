import { demoteOtherLiveOnCourt } from '../lib/courtLive.js';
import { addPointToCurrentGame } from '../lib/scoring.js';
import { finalizeFinishedMatch, applyManualScoresFromBody } from '../lib/matchResult.js';
import { broadcastMatchUpdate } from '../lib/matchSocket.js';
import { requireStaffApi } from '../middleware/auth.js';
import { normalizeTimeToHHmm } from '../lib/matchTime.js';
import { countGamesWon } from '../lib/viewHelpers.js';
import { findVenue } from '../lib/venues.js';
import { findAccessibleMatch, findAccessibleTournament, forbidAccess } from '../lib/eventAccess.js';
import { Match } from '../models/Match.js';
import { Team } from '../models/Team.js';
import { Tournament } from '../models/Tournament.js';
import { Event } from '../models/Event.js';
import mongoose from 'mongoose';
import { Router } from 'express';

const MATCH_STATUSES = ['scheduled', 'live', 'finished', 'postponed', 'cancelled'];

function winsNeeded(matchFormat) {
  if (matchFormat === 'singleGame') return 1;
  if (matchFormat === 'bestOf5') return 3;
  return 2;
}

export const adminApiRouter = Router();
adminApiRouter.use(requireStaffApi);

adminApiRouter.param('matchId', async (req, res, next, id) => {
  try {
    const match = await findAccessibleMatch(req.session, id);
    if (!match) {
      if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'invalid_id' });
      const exists = await Match.exists({ _id: id });
      if (!exists) return res.status(404).json({ error: 'not_found' });
      return forbidAccess(req, res);
    }
    req.matchDoc = match;
    next();
  } catch (e) {
    next(e);
  }
});

adminApiRouter.param('teamId', async (req, res, next, id) => {
  try {
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'invalid_id' });
    const team = await Team.findById(id);
    if (!team) return res.status(404).json({ error: 'not_found' });
    const tournament = await findAccessibleTournament(req.session, team.tournamentId);
    if (!tournament) return forbidAccess(req, res);
    req.teamDoc = team;
    next();
  } catch (e) {
    next(e);
  }
});

adminApiRouter.post('/matches/:matchId/point', async (req, res, next) => {
  try {
    const side = req.body?.side;
    if (side !== 'a' && side !== 'b') {
      return res.status(400).json({ error: 'invalid_side' });
    }

    const match = req.matchDoc;
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

adminApiRouter.post('/matches/:matchId/status', async (req, res, next) => {
  try {
    const status = String(req.body?.status || '').trim();
    if (!MATCH_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'invalid_status' });
    }

    const match = req.matchDoc;

    match.status = status;
    if (status === 'finished') {
      finalizeFinishedMatch(match);
    }

    await match.save();
    if (match.status === 'live') {
      try {
        await demoteOtherLiveOnCourt(match);
      } catch (err) {
        console.error('demoteOtherLiveOnCourt failed:', err);
      }
    }
    try {
      await broadcastMatchUpdate(req.app, match._id);
    } catch (err) {
      console.error('broadcastMatchUpdate failed:', err);
    }

    const populated = await Match.findById(match._id).populate('teamA teamB winnerId').lean();
    res.json({ ok: true, status: populated?.status || status, match: populated });
  } catch (e) {
    next(e);
  }
});

/** 賽事列表內聯快速更新：時間、場地、各局比分 */
adminApiRouter.post('/matches/:matchId/quick-update', async (req, res, next) => {
  try {
    const match = req.matchDoc;

    const body = req.body || {};

    if (body.scheduledTime !== undefined) {
      match.scheduledTime = normalizeTimeToHHmm(body.scheduledTime);
      match.scheduledAt = null;
    }
    if (body.court !== undefined) {
      const raw = String(body.court || '').trim();
      match.court = raw;
      const tournament = await Tournament.findById(match.tournamentId).select('eventId').lean();
      if (tournament) {
        const event = await Event.findById(tournament.eventId).select('venues').lean();
        const v = findVenue(event?.venues, raw);
        if (v) match.court = v.slug;
      }
    }

    const hasScoreFields =
      body.completedGameA !== undefined ||
      body.completedGameB !== undefined ||
      body.completedGames !== undefined;

    if (hasScoreFields) {
      if (Array.isArray(body.completedGames)) {
        const games = [];
        for (const g of body.completedGames) {
          const aRaw = g?.a;
          const bRaw = g?.b;
          const aEmpty = aRaw == null || String(aRaw).trim() === '';
          const bEmpty = bRaw == null || String(bRaw).trim() === '';
          if (aEmpty && bEmpty) continue;
          const a = parseInt(String(aRaw ?? '0'), 10);
          const b = parseInt(String(bRaw ?? '0'), 10);
          games.push({
            a: Number.isNaN(a) || a < 0 ? 0 : a,
            b: Number.isNaN(b) || b < 0 ? 0 : b,
          });
        }
        match.completedGames = games;
        match.currentPoints = { a: 0, b: 0 };
        match.currentGameIndex = games.length;
        match.markModified('completedGames');
        match.markModified('currentPoints');
      } else {
        applyManualScoresFromBody(match, {
          completedGameA: body.completedGameA,
          completedGameB: body.completedGameB,
          currentPointA: body.currentPointA ?? 0,
          currentPointB: body.currentPointB ?? 0,
        });
      }

      const { gamesA, gamesB } = countGamesWon(match.completedGames);
      const need = winsNeeded(match.matchFormat);
      if (gamesA >= need || gamesB >= need) {
        match.status = 'finished';
        finalizeFinishedMatch(match);
      } else if ((match.completedGames?.length || 0) > 0) {
        if (match.status === 'scheduled' || match.status === 'finished') {
          match.status = 'live';
          match.winnerId = undefined;
        }
      } else if (match.status === 'live' || match.status === 'finished') {
        match.status = 'scheduled';
        match.winnerId = undefined;
      }
    }

    if (body.status && MATCH_STATUSES.includes(String(body.status))) {
      match.status = String(body.status);
      if (match.status === 'finished') finalizeFinishedMatch(match);
    }

    await match.save();
    if (match.status === 'live') {
      try {
        await demoteOtherLiveOnCourt(match);
      } catch (err) {
        console.error('demoteOtherLiveOnCourt failed:', err);
      }
    }
    try {
      await broadcastMatchUpdate(req.app, match._id);
    } catch (err) {
      console.error('broadcastMatchUpdate failed:', err);
    }

    const populated = await Match.findById(match._id).populate('teamA teamB winnerId').lean();
    res.json({ ok: true, match: populated });
  } catch (e) {
    next(e);
  }
});

adminApiRouter.post('/teams/:teamId/check-in', async (req, res, next) => {
  try {
    const team = req.teamDoc;
    if (!team || team.isPlaceholder) return res.status(404).json({ error: 'not_found' });

    const raw = req.body?.checkedIn;
    team.checkedIn = raw === true || raw === 'true' || raw === '1' || raw === 1;
    await team.save();

    res.json({ ok: true, checkedIn: team.checkedIn });
  } catch (e) {
    next(e);
  }
});
