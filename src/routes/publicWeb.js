import { Router } from 'express';
import mongoose from 'mongoose';
import { loadEventBySlug } from '../middleware/loadEvent.js';
import { Match } from '../models/Match.js';
import { Group } from '../models/Group.js';
import { Tournament } from '../models/Tournament.js';
import { enrichMatchesForSchedule } from '../lib/viewHelpers.js';
import { getOrCreateScoreboard, normalizeScoreboardSlot } from '../models/LiveScoreboard.js';
import { getEventGroupStandings } from '../lib/groupStandings.js';

export const publicWebRouter = Router({ mergeParams: true });

publicWebRouter.get('/:eventSlug', loadEventBySlug, async (req, res, next) => {
  try {
    const event = req.event;
    const tournaments = await Tournament.find({ eventId: event._id }).sort({ order: 1 }).lean();
    const tids = tournaments.map((t) => t._id);
    const [matchesRaw, groups] = await Promise.all([
      Match.find({ tournamentId: { $in: tids } })
        .populate('teamA teamB')
        .sort({ scheduledTime: 1, createdAt: 1 })
        .lean(),
      Group.find({ tournamentId: { $in: tids } }).select('_id name tournamentId').lean(),
    ]);
    const matches = enrichMatchesForSchedule(matchesRaw, tournaments, groups);

    const groupStandingsList = await getEventGroupStandings(event._id);
    const highlightTeam = String(req.query.team || req.query.q || '').trim();

    res.render('pages/event', {
      title: event.name,
      event,
      tournaments,
      matches,
      groupStandingsList,
      highlightTeam,
      eventIdStr: event._id.toString(),
    });
  } catch (e) {
    next(e);
  }
});

publicWebRouter.get('/:eventSlug/screen/:matchId', loadEventBySlug, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    if (!mongoose.isValidObjectId(matchId)) {
      return res.status(404).render('pages/error', { title: '找不到場次', message: '場次 ID 無效。' });
    }
    const event = req.event;
    const match = await Match.findOne({
      _id: matchId,
    })
      .populate('teamA teamB')
      .lean();

    if (!match || String(match.tournamentId) === '') {
      return res.status(404).render('pages/error', { title: '找不到場次', message: '查無此比賽。' });
    }

    const t = await Tournament.findById(match.tournamentId).lean();
    if (!t || String(t.eventId) !== String(event._id)) {
      return res.status(404).render('pages/error', { title: '找不到場次', message: '此場次不屬於本大會。' });
    }

    res.render('pages/screen', {
      title: `${match.teamA?.name || 'A'} vs ${match.teamB?.name || 'B'}`,
      event,
      match,
      eventIdStr: event._id.toString(),
    });
  } catch (e) {
    next(e);
  }
});

async function renderScoreboardDisplay(req, res, slot) {
  const event = req.event;
  const scoreboard = (await getOrCreateScoreboard(event._id, slot)).toObject();
  const obsMode = req.query.obs === '1' || req.query.obs === 'true';
  const transparent = obsMode || req.query.transparent === '1';
  res.render('pages/scoreboard-display', {
    title: `${scoreboard.teamAName} vs ${scoreboard.teamBName}`,
    event,
    scoreboard,
    eventIdStr: event._id.toString(),
    scoreboardSlot: normalizeScoreboardSlot(slot),
    obsMode,
    transparent,
  });
}

/** 大會計分牌 — 場地 2 */
publicWebRouter.get('/:eventSlug/scoreboard/2', loadEventBySlug, async (req, res, next) => {
  try {
    await renderScoreboardDisplay(req, res, 2);
  } catch (e) {
    next(e);
  }
});

/** 大會計分牌 — 場地 1（預設） */
publicWebRouter.get('/:eventSlug/scoreboard', loadEventBySlug, async (req, res, next) => {
  try {
    await renderScoreboardDisplay(req, res, 1);
  } catch (e) {
    next(e);
  }
});
