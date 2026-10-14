import { Router } from 'express';
import mongoose from 'mongoose';
import { Event } from '../models/Event.js';
import { Tournament } from '../models/Tournament.js';
import { Match } from '../models/Match.js';
import { DisplayContent } from '../models/DisplayContent.js';
import { getEventGroupStandings } from '../lib/groupStandings.js';
import { isShowOnWebsite } from '../lib/publicListing.js';

export const publicApiRouter = Router();

async function getEventBySlug(slug) {
  const s = String(slug).toLowerCase().trim();
  return Event.findOne({ $or: [{ slug: s }, { slugAliases: s }] }).lean();
}

publicApiRouter.get('/events/:slug', async (req, res) => {
  const event = await getEventBySlug(req.params.slug);
  if (!event) return res.status(404).json({ error: 'not_found' });
  if (!event.isActive) return res.status(404).json({ error: 'not_found' });
  res.json({ event });
});

publicApiRouter.get('/events/:slug/standings', async (req, res) => {
  const event = await getEventBySlug(req.params.slug);
  if (!event) return res.status(404).json({ error: 'not_found' });
  if (!event.isActive) return res.status(404).json({ error: 'not_found' });
  const standings = await getEventGroupStandings(event._id, { listedOnly: true });
  res.json({ event: { id: event._id, slug: event.slug, name: event.name }, standings });
});

publicApiRouter.get('/events/:slug/matches', async (req, res) => {
  const event = await getEventBySlug(req.params.slug);
  if (!event) return res.status(404).json({ error: 'not_found' });
  if (!event.isActive) return res.status(404).json({ error: 'not_found' });
  const tournaments = await Tournament.find({ eventId: event._id }).select('_id showOnWebsite').lean();
  const publicTids = tournaments.filter((t) => isShowOnWebsite(t)).map((t) => t._id);
  const matches = await Match.find({ tournamentId: { $in: publicTids }, showOnWebsite: { $ne: false } })
    .populate('teamA teamB winnerId')
    .sort({ scheduledDate: 1, scheduledTime: 1, createdAt: 1 })
    .lean();
  res.json({ matches });
});

publicApiRouter.get('/events/:slug/display', async (req, res) => {
  const event = await getEventBySlug(req.params.slug);
  if (!event) return res.status(404).json({ error: 'not_found' });
  if (!event.isActive) return res.status(404).json({ error: 'not_found' });
  const items = await DisplayContent.find({ eventId: event._id, isPublished: true })
    .sort({ order: 1 })
    .lean();
  res.json({ items });
});

publicApiRouter.get('/matches/:id', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'not_found' });
  const match = await Match.findById(id).populate('teamA teamB winnerId').lean();
  if (!match) return res.status(404).json({ error: 'not_found' });
  const tournament = await Tournament.findById(match.tournamentId).select('eventId showOnWebsite').lean();
  if (!tournament || !isShowOnWebsite(tournament) || !isShowOnWebsite(match)) {
    return res.status(404).json({ error: 'not_found' });
  }
  const event = await Event.findById(tournament.eventId).select('isActive').lean();
  if (!event?.isActive) return res.status(404).json({ error: 'not_found' });
  res.json({ match });
});
