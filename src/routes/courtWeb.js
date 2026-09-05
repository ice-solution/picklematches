import { Router } from 'express';
import { loadEventBySlug } from '../middleware/loadEvent.js';
import { requireCourtSession } from '../middleware/courtAuth.js';
import {
  findVenue,
  normalizeEventVenues,
  normalizeVenueSlug,
  verifyVenuePin,
} from '../lib/venues.js';
import { findLiveMatchOnCourt } from '../lib/courtLive.js';

export const courtWebRouter = Router({ mergeParams: true });

courtWebRouter.get('/:eventSlug/court/login', loadEventBySlug, (req, res) => {
  const event = req.event;
  const venues = normalizeEventVenues(event.venues);
  const preselect = normalizeVenueSlug(req.query.venue || '');
  const error =
    req.query.error === 'pin'
      ? 'PIN 不正確或此場地尚未設定 PIN'
      : req.query.error === 'venue'
        ? '請選擇場地'
        : null;

  res.render('pages/court-login', {
    title: `場地登入 — ${event.name}`,
    event,
    venues,
    preselect,
    error,
  });
});

courtWebRouter.post('/:eventSlug/court/login', loadEventBySlug, async (req, res, next) => {
  try {
    const event = req.event;
    const venues = normalizeEventVenues(event.venues);
    const venueSlug = normalizeVenueSlug(req.body.venueSlug);
    const pin = String(req.body.pin || '');
    const venue = findVenue(venues, venueSlug);

    if (!venue) {
      return res.redirect(`/e/${event.slug}/court/login?error=venue`);
    }

    const ok = await verifyVenuePin(venue, pin);
    if (!ok) {
      return res.redirect(`/e/${event.slug}/court/login?venue=${encodeURIComponent(venue.slug)}&error=pin`);
    }

    req.session.courtAuth = {
      eventId: String(event._id),
      venueSlug: venue.slug,
    };
    res.redirect(`/e/${event.slug}/court/${venue.slug}/control`);
  } catch (e) {
    next(e);
  }
});

courtWebRouter.post('/:eventSlug/court/logout', loadEventBySlug, (req, res) => {
  delete req.session.courtAuth;
  res.redirect(`/e/${req.event.slug}/court/login`);
});

courtWebRouter.get(
  '/:eventSlug/court/:venueSlug/control',
  loadEventBySlug,
  requireCourtSession,
  async (req, res, next) => {
    try {
      const event = req.event;
      const venue = req.courtVenue;
      const match = await findLiveMatchOnCourt(event, venue.slug);
      res.render('pages/court-control', {
        title: `${venue.name} 計分 — ${event.name}`,
        event,
        venue,
        match,
        eventIdStr: String(event._id),
      });
    } catch (e) {
      next(e);
    }
  }
);

courtWebRouter.get('/:eventSlug/court/:venueSlug/live', loadEventBySlug, async (req, res, next) => {
  try {
    const event = req.event;
    const venueSlug = normalizeVenueSlug(req.params.venueSlug);
    const venue = findVenue(normalizeEventVenues(event.venues), venueSlug);
    if (!venue) {
      return res.status(404).render('pages/error', {
        title: '找不到場地',
        message: '此大會沒有該場地。',
      });
    }
    const match = await findLiveMatchOnCourt(event, venue.slug);
    res.render('pages/court-live', {
      title: `${venue.name} Live — ${event.name}`,
      event,
      venue,
      match,
      eventIdStr: String(event._id),
    });
  } catch (e) {
    next(e);
  }
});
