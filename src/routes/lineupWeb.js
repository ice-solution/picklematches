import { Router } from 'express';
import mongoose from 'mongoose';
import { loadEventBySlug } from '../middleware/loadEvent.js';
import { Match, MATCH_FORMAT } from '../models/Match.js';
import { Tournament } from '../models/Tournament.js';
import {
  ensureLineupTokens,
  getSideLineup,
  opponentForSide,
  rosterFromTeam,
  teamForSide,
  LEAGUE_GAME_LABELS,
} from '../lib/leagueLineup.js';
import { matchScheduleDate, displayMatchTime, displayMatchSchedule, compareMatchesBySchedule } from '../lib/matchTime.js';
import { venueLabel, normalizeEventVenues } from '../lib/venues.js';

export const lineupWebRouter = Router({ mergeParams: true });

function normalizeSide(side) {
  if (side === 'a' || side === 'A') return 'a';
  if (side === 'b' || side === 'B') return 'b';
  return '';
}

/** 聯賽賽事 iPad 入口：揀場次（賽程／賽制）→ 揀隊 */
lineupWebRouter.get('/:eventSlug/lineup-hub/:tournamentId', loadEventBySlug, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) {
      return res.status(404).render('pages/error', { title: '找不到賽事', message: '賽事 ID 無效。' });
    }
    const event = req.event;
    const tournament = await Tournament.findById(tournamentId).lean();
    if (!tournament || String(tournament.eventId) !== String(event._id) || tournament.phase !== 'league') {
      return res.status(404).render('pages/error', { title: '找不到賽事', message: '此賽事不是聯賽，或唔屬於本大會。' });
    }

    const venues = normalizeEventVenues(event.venues);
    const matches = await Match.find({
      tournamentId,
      matchFormat: MATCH_FORMAT.LEAGUE_FIVE,
    })
      .populate('teamA teamB')
      .exec();

    const competitionDate = tournament.competitionDate || '';
    matches.sort((a, b) =>
      compareMatchesBySchedule(
        { scheduledDate: a.scheduledDate, scheduledTime: a.scheduledTime, createdAt: a.createdAt, competitionDate },
        { scheduledDate: b.scheduledDate, scheduledTime: b.scheduledTime, createdAt: b.createdAt, competitionDate },
      ),
    );

    const rows = [];
    for (const match of matches) {
      const changed = ensureLineupTokens(match);
      if (changed) await match.save();

      const lineupA = getSideLineup(match, 'a');
      const lineupB = getSideLineup(match, 'b');
      const scheduleLabel = displayMatchSchedule({
        scheduledDate: match.scheduledDate,
        scheduledTime: match.scheduledTime,
        competitionDate,
      });
      rows.push({
        matchId: String(match._id),
        scheduleLabel: scheduleLabel === '—' ? '' : scheduleLabel,
        time: displayMatchTime(match),
        court: match.court ? venueLabel(venues, match.court) : '',
        round: match.round || '',
        teamAName: match.teamA?.name || '隊 A',
        teamBName: match.teamB?.name || '隊 B',
        confirmedA: lineupA.confirmed,
        confirmedB: lineupB.confirmed,
        urlA: `/e/${event.slug}/lineup/${match._id}/a/${lineupA.token}`,
        urlB: `/e/${event.slug}/lineup/${match._id}/b/${lineupB.token}`,
      });
    }

    res.render('pages/lineup-hub', {
      title: `排陣 — ${tournament.name}`,
      event,
      tournament,
      rows,
    });
  } catch (e) {
    next(e);
  }
});

lineupWebRouter.get('/:eventSlug/lineup/:matchId/:side/:token', loadEventBySlug, async (req, res, next) => {
  try {
    const { matchId, side: sideRaw, token } = req.params;
    const side = normalizeSide(sideRaw);
    if (!mongoose.isValidObjectId(matchId) || !side || !token) {
      return res.status(404).render('pages/error', { title: '找不到排陣', message: '連結無效。' });
    }

    const event = req.event;
    const match = await Match.findById(matchId).populate('teamA teamB').exec();
    if (!match) {
      return res.status(404).render('pages/error', { title: '找不到排陣', message: '查無此場次。' });
    }

    const tournament = await Tournament.findById(match.tournamentId).lean();
    if (!tournament || String(tournament.eventId) !== String(event._id)) {
      return res.status(404).render('pages/error', { title: '找不到排陣', message: '此場次不屬於本大會。' });
    }
    if (match.matchFormat !== MATCH_FORMAT.LEAGUE_FIVE && tournament.phase !== 'league') {
      return res.status(404).render('pages/error', { title: '找不到排陣', message: '此場次不是聯賽排陣場次。' });
    }

    ensureLineupTokens(match);
    if (match.isModified('lineupBySide')) await match.save();

    const lineup = getSideLineup(match, side);
    if (!lineup.token || lineup.token !== String(token)) {
      return res.status(404).render('pages/error', { title: '找不到排陣', message: '連結無效或已失效。' });
    }

    const team = teamForSide(match, side);
    const opponent = opponentForSide(match, side);
    const roster = rosterFromTeam(team);
    const venues = normalizeEventVenues(event.venues);

    const scheduleDate = matchScheduleDate({
      ...match.toObject(),
      competitionDate: tournament.competitionDate,
    });
    const hubUrl = `/e/${event.slug}/lineup-hub/${tournament._id}`;

    res.render('pages/lineup-board', {
      title: `排陣 — ${team?.name || '隊伍'}`,
      event,
      tournament,
      match: match.toObject(),
      side,
      token: lineup.token,
      lineup,
      team,
      opponent,
      roster,
      gameLabels: LEAGUE_GAME_LABELS,
      scheduleDate,
      scheduleTime: displayMatchTime(match),
      courtLabel: match.court ? venueLabel(venues, match.court) : '',
      confirmed: lineup.confirmed,
      hubUrl,
    });
  } catch (e) {
    next(e);
  }
});
