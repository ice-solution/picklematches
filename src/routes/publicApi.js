import { Router } from 'express';
import mongoose from 'mongoose';
import { Event } from '../models/Event.js';
import { Tournament } from '../models/Tournament.js';
import { Match } from '../models/Match.js';
import { DisplayContent } from '../models/DisplayContent.js';
import { getOrCreateScoreboard } from '../models/LiveScoreboard.js';

export const publicApiRouter = Router();

async function getEventBySlug(slug) {
  const s = String(slug).toLowerCase().trim();
  return Event.findOne({ $or: [{ slug: s }, { slugAliases: s }] }).lean();
}

publicApiRouter.get('/events/:slug', async (req, res) => {
  const event = await getEventBySlug(req.params.slug);
  if (!event) return res.status(404).json({ error: 'not_found' });
  res.json({ event });
});

publicApiRouter.get('/events/:slug/matches', async (req, res) => {
  const event = await getEventBySlug(req.params.slug);
  if (!event) return res.status(404).json({ error: 'not_found' });
  const tournaments = await Tournament.find({ eventId: event._id }).select('_id').lean();
  const ids = tournaments.map((t) => t._id);
  const matches = await Match.find({ tournamentId: { $in: ids } })
    .populate('teamA teamB winnerId')
    .sort({ scheduledTime: 1, createdAt: 1 })
    .lean();
  res.json({ matches });
});

publicApiRouter.get('/events/:slug/display', async (req, res) => {
  const event = await getEventBySlug(req.params.slug);
  if (!event) return res.status(404).json({ error: 'not_found' });
  const items = await DisplayContent.find({ eventId: event._id, isPublished: true })
    .sort({ order: 1 })
    .lean();
  res.json({ items });
});

/** 大會計分牌 JSON（供 OBS、外部疊圖或匯出） */
publicApiRouter.get('/events/:slug/scoreboard', async (req, res) => {
  const event = await getEventBySlug(req.params.slug);
  if (!event) return res.status(404).json({ error: 'not_found' });
  const scoreboard = (await getOrCreateScoreboard(event._id)).toObject();
  res.json({
    event: { id: event._id, name: event.name, slug: event.slug },
    scoreboard,
    updatedAt: scoreboard.updatedAt,
  });
});

publicApiRouter.get('/matches/:id', async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: 'not_found' });
  const match = await Match.findById(id).populate('teamA teamB winnerId').lean();
  if (!match) return res.status(404).json({ error: 'not_found' });
  res.json({ match });
});
