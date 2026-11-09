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
import {
  callTimeout,
  callWarmup,
  cancelActiveTimeout,
  clearExpiredTimeout,
  isTimeoutActive,
  undoTimeoutUsed,
} from '../lib/courtTimeout.js';
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
      const lean = await findLiveMatchOnCourt(req.event, venueSlug);
      if (!lean) return res.json({ ok: true, match: null });
      const doc = await Match.findById(lean._id);
      if (doc && clearExpiredTimeout(doc)) {
        await doc.save();
        const populated = await Match.findById(doc._id).populate('teamA teamB winnerId').lean();
        return res.json({ ok: true, match: populated });
      }
      res.json({ ok: true, match: lean });
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
      clearExpiredTimeout(match);
      if (isTimeoutActive(match)) return res.status(400).json({ error: 'timeout_active' });

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
  '/:eventSlug/court/:venueSlug/swap-sides',
  loadEventBySlug,
  requireCourtSession,
  async (req, res, next) => {
    try {
      const match = await loadLiveMatchDoc(req.event, req.courtVenue.slug);
      if (!match) return res.status(404).json({ error: 'no_live_match' });
      if (match.status !== 'live' && match.status !== 'scheduled') {
        return res.status(400).json({ error: 'not_live' });
      }
      match.sidesSwapped = !match.sidesSwapped;
      if (match.status === 'scheduled') match.status = 'live';
      await match.save();
      await respondMatch(req.app, match, res);
    } catch (e) {
      next(e);
    }
  }
);

courtApiRouter.post(
  '/:eventSlug/court/:venueSlug/timeout',
  loadEventBySlug,
  requireCourtSession,
  async (req, res, next) => {
    try {
      const match = await loadLiveMatchDoc(req.event, req.courtVenue.slug);
      if (!match) return res.status(404).json({ error: 'no_live_match' });

      const r = callTimeout(match, req.body?.side);
      if (!r.ok) return res.status(400).json({ error: r.error });

      await match.save();
      await respondMatch(req.app, match, res);
    } catch (e) {
      next(e);
    }
  }
);

courtApiRouter.post(
  '/:eventSlug/court/:venueSlug/warmup',
  loadEventBySlug,
  requireCourtSession,
  async (req, res, next) => {
    try {
      const match = await loadLiveMatchDoc(req.event, req.courtVenue.slug);
      if (!match) return res.status(404).json({ error: 'no_live_match' });

      const r = callWarmup(match);
      if (!r.ok) return res.status(400).json({ error: r.error });

      await match.save();
      await respondMatch(req.app, match, res);
    } catch (e) {
      next(e);
    }
  }
);

courtApiRouter.post(
  '/:eventSlug/court/:venueSlug/timeout-cancel',
  loadEventBySlug,
  requireCourtSession,
  async (req, res, next) => {
    try {
      const match = await loadLiveMatchDoc(req.event, req.courtVenue.slug);
      if (!match) return res.status(404).json({ error: 'no_live_match' });

      const r = cancelActiveTimeout(match);
      if (!r.ok) return res.status(400).json({ error: r.error });

      await match.save();
      await respondMatch(req.app, match, res);
    } catch (e) {
      next(e);
    }
  }
);

courtApiRouter.post(
  '/:eventSlug/court/:venueSlug/timeout-undo',
  loadEventBySlug,
  requireCourtSession,
  async (req, res, next) => {
    try {
      const match = await loadLiveMatchDoc(req.event, req.courtVenue.slug);
      if (!match) return res.status(404).json({ error: 'no_live_match' });

      const r = undoTimeoutUsed(match, req.body?.side);
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
      clearExpiredTimeout(match);
      if (isTimeoutActive(match)) return res.status(400).json({ error: 'timeout_active' });

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
