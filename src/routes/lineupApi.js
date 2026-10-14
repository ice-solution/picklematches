import { Router } from 'express';
import mongoose from 'mongoose';
import { Match, MATCH_FORMAT } from '../models/Match.js';
import { Tournament } from '../models/Tournament.js';
import {
  applySideLineup,
  ensureLineupTokens,
  getSideLineup,
  rosterFromTeam,
  teamForSide,
} from '../lib/leagueLineup.js';

export const lineupApiRouter = Router();

function normalizeSide(side) {
  if (side === 'a' || side === 'A') return 'a';
  if (side === 'b' || side === 'B') return 'b';
  return '';
}

async function loadLineupMatch(matchId, side, token) {
  if (!mongoose.isValidObjectId(matchId)) return { error: 'not_found', status: 404 };
  const s = normalizeSide(side);
  if (!s || !token) return { error: 'not_found', status: 404 };

  const match = await Match.findById(matchId).populate('teamA teamB').exec();
  if (!match) return { error: 'not_found', status: 404 };

  const tournament = await Tournament.findById(match.tournamentId).select('phase eventId').lean();
  if (!tournament) return { error: 'not_found', status: 404 };
  if (match.matchFormat !== MATCH_FORMAT.LEAGUE_FIVE && tournament.phase !== 'league') {
    return { error: 'not_league', status: 400 };
  }

  ensureLineupTokens(match);
  const lineup = getSideLineup(match, s);
  if (!lineup.token || lineup.token !== String(token)) {
    return { error: 'forbidden', status: 403 };
  }
  return { match, side: s, tournament };
}

lineupApiRouter.post('/lineup/:matchId/:side/:token', async (req, res, next) => {
  try {
    const loaded = await loadLineupMatch(req.params.matchId, req.params.side, req.params.token);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });

    const { match, side } = loaded;
    const team = teamForSide(match, side);
    const roster = rosterFromTeam(team);
    const confirm = req.body?.confirm === true || req.body?.confirm === '1' || req.body?.action === 'confirm';

    const result = applySideLineup(match, side, {
      games: req.body?.games,
      confirm,
      roster,
    });
    if (!result.ok) {
      return res.status(400).json({
        error: result.error,
        slot: result.slot,
        label: result.label,
        player: result.player,
        count: result.count,
        max: result.max,
      });
    }

    await match.save();
    res.json({
      ok: true,
      confirmed: result.lineup.confirmed,
      lineup: result.lineup,
    });
  } catch (e) {
    next(e);
  }
});
