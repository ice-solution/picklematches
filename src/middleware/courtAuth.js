import { findVenue, normalizeEventVenues, normalizeVenueSlug } from '../lib/venues.js';

/** Session: { eventId, venueSlug } */
export function requireCourtSession(req, res, next) {
  const auth = req.session?.courtAuth;
  const event = req.event;
  const venueSlug = normalizeVenueSlug(req.params.venueSlug || req.body?.venueSlug);

  if (!auth || !event || String(auth.eventId) !== String(event._id)) {
    if (req.path.startsWith('/api') || req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(401).json({ error: 'court_auth_required' });
    }
    return res.redirect(`/e/${event?.slug || req.params.eventSlug}/court/login`);
  }

  if (venueSlug && auth.venueSlug !== venueSlug) {
    if (req.path.startsWith('/api') || req.headers.accept?.includes('application/json')) {
      return res.status(403).json({ error: 'court_mismatch' });
    }
    return res.redirect(`/e/${event.slug}/court/login`);
  }

  const venue = findVenue(normalizeEventVenues(event.venues), auth.venueSlug);
  if (!venue) {
    delete req.session.courtAuth;
    if (req.headers.accept?.includes('application/json')) {
      return res.status(404).json({ error: 'venue_not_found' });
    }
    return res.redirect(`/e/${event.slug}/court/login`);
  }

  req.courtVenue = venue;
  next();
}

export function optionalCourtSession(req, _res, next) {
  const auth = req.session?.courtAuth;
  const event = req.event;
  if (auth && event && String(auth.eventId) === String(event._id)) {
    req.courtVenue = findVenue(normalizeEventVenues(event.venues), auth.venueSlug) || null;
  }
  next();
}
