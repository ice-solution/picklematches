import { Router } from 'express';
import { loadEventBySlug } from '../middleware/loadEvent.js';
import { requireCourtSession } from '../middleware/courtAuth.js';
import { Match } from '../models/Match.js';
import {
  adjustCurrentPoints,
  commitCurrentGame,
  finishMatchManual,
  setServingSide,
} from '../lib/scoring.js';
import { findLiveMatchOnCourt } from '../lib/courtLive.js';
import { broadcastMatchUpdate, broadcastCourtIdle } from '../lib/matchSocket.js';
import { normalizeVenueSlug } from '../lib/venues.js';

export const courtApiRouter = Router({ mergeParams: true });

async function loadLiveMatchDoc(event, venueSlug) {
  const lean = await findLiveMatchOnCourt(event, venueSlug);
  if (!lean) return null;
  return Match.findById(lean._id);
}

async function respondMatch(app, match, res) {
  let populated = null;
  try {
    populated = await broadcastMatchUpdate(app, match._id);
  } catch (err) {
    console.error('broadcastMatchUpdate failed:', err);
    populated = await Match.findById(match._id).populate('teamA teamB winnerId').lean();
  }
  res.json({ ok: true, match: populated });
}

courtApiRouter.get(
  '/:eventSlug/court/:venueSlug/state',
  loadEventBySlug,
  async (req, res, next) => {
    try {
      const venueSlug = normalizeVenueSlug(req.params.venueSlug);
      const match = await findLiveMatchOnCourt(req.event, venueSlug);
      res.json({ ok: true, match: match || null });
    } catch (e) {
      next(e);
    }
  }
);

courtApiRouter.post(
  '/:eventSlug/court/:venueSlug/point',
  loadEventBySlug,
  requireCourtSession,
  async (req, res, next) => {
    try {
      const side = req.body?.side;
      const delta = Number(req.body?.delta);
      const match = await loadLiveMatchDoc(req.event, req.courtVenue.slug);
      if (!match) return res.status(404).json({ error: 'no_live_match' });

      const r = adjustCurrentPoints(match, side, delta);
      if (!r.ok) return res.status(400).json({ error: r.error });

      await match.save();
      await respondMatch(req.app, match, res);
    } catch (e) {
      next(e);
    }
  }
);

courtApiRouter.post(
  '/:eventSlug/court/:venueSlug/serve',
  loadEventBySlug,
  requireCourtSession,
  async (req, res, next) => {
    try {
      const side = String(req.body?.side || '').toLowerCase();
      const match = await loadLiveMatchDoc(req.event, req.courtVenue.slug);
      if (!match) return res.status(404).json({ error: 'no_live_match' });

      const r = setServingSide(match, side);
      if (!r.ok) return res.status(400).json({ error: r.error });

      await match.save();
      await respondMatch(req.app, match, res);
    } catch (e) {
      next(e);
    }
  }
);

courtApiRouter.post(
  '/:eventSlug/court/:venueSlug/next-game',
  loadEventBySlug,
  requireCourtSession,
  async (req, res, next) => {
    try {
      const match = await loadLiveMatchDoc(req.event, req.courtVenue.slug);
      if (!match) return res.status(404).json({ error: 'no_live_match' });

      const r = commitCurrentGame(match);
      if (!r.ok) return res.status(400).json({ error: r.error });

      await match.save();
      await respondMatch(req.app, match, res);
    } catch (e) {
      next(e);
    }
  }
);

courtApiRouter.post(
  '/:eventSlug/court/:venueSlug/finish',
  loadEventBySlug,
  requireCourtSession,
  async (req, res, next) => {
    try {
      const match = await loadLiveMatchDoc(req.event, req.courtVenue.slug);
      if (!match) return res.status(404).json({ error: 'no_live_match' });

      const r = finishMatchManual(match);
      if (!r.ok) return res.status(400).json({ error: r.error });

      await match.save();
      let populated = null;
      try {
        populated = await broadcastMatchUpdate(req.app, match._id);
      } catch (err) {
        console.error('broadcastMatchUpdate failed:', err);
        populated = await Match.findById(match._id).populate('teamA teamB winnerId').lean();
      }
      await broadcastCourtIdle(req.app, req.event._id, req.courtVenue.slug);
      res.json({ ok: true, match: populated });
    } catch (e) {
      next(e);
    }
  }
);
