import { Router } from 'express';
import mongoose from 'mongoose';
import { Event } from '../models/Event.js';
import { Tournament } from '../models/Tournament.js';
import { Match } from '../models/Match.js';
import { LiveScoreboard, getOrCreateScoreboard } from '../models/LiveScoreboard.js';
import { broadcastScoreboardUpdate } from '../lib/scoreboardSocket.js';
import { scoreboardFieldsFromMatch } from '../lib/scoreboardFromMatch.js';
import {
  maybeMarkScoreboardFinished,
  pushScoreboardToLinkedMatchIfFinished,
} from '../lib/scoreboardPush.js';
import { broadcastMatchUpdate } from '../lib/matchSocket.js';
import { requireStaffApi } from '../middleware/auth.js';

export const scoreboardApiRouter = Router();
scoreboardApiRouter.use(requireStaffApi);

function clampNonNeg(n, fallback = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.floor(v));
}

async function loadBoardForEvent(eventId) {
  if (!mongoose.isValidObjectId(eventId)) return { error: 'invalid_id', status: 400 };
  const event = await Event.findById(eventId).lean();
  if (!event) return { error: 'not_found', status: 404 };
  const board = await getOrCreateScoreboard(event._id);
  return { event, board };
}

async function saveBoardAndRespond(req, res, board, eventId, extra = {}) {
  await board.save();
  const populated = await broadcastScoreboardUpdate(req.app, board.eventId);
  const synced = await pushScoreboardToLinkedMatchIfFinished(req.app, board, eventId);
  res.json({
    ok: true,
    scoreboard: populated,
    matchSynced: Boolean(synced),
    matchEditUrl: synced?.editUrl || null,
    ...extra,
  });
}

/** 取得計分牌 */
scoreboardApiRouter.get('/events/:eventId/scoreboard', async (req, res) => {
  const r = await loadBoardForEvent(req.params.eventId);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true, scoreboard: r.board.toObject ? r.board.toObject() : r.board });
});

/** 完整更新計分牌 */
scoreboardApiRouter.patch('/events/:eventId/scoreboard', async (req, res) => {
  const r = await loadBoardForEvent(req.params.eventId);
  if (r.error) return res.status(r.status).json({ error: r.error });

  const body = req.body || {};
  const board = r.board;

  if (body.teamAName !== undefined) board.teamAName = String(body.teamAName).trim() || '隊伍 A';
  if (body.teamBName !== undefined) board.teamBName = String(body.teamBName).trim() || '隊伍 B';
  if (body.scoreA !== undefined) board.scoreA = clampNonNeg(body.scoreA);
  if (body.scoreB !== undefined) board.scoreB = clampNonNeg(body.scoreB);
  if (body.gamesA !== undefined) board.gamesA = clampNonNeg(body.gamesA);
  if (body.gamesB !== undefined) board.gamesB = clampNonNeg(body.gamesB);
  if (body.subtitle !== undefined) board.subtitle = String(body.subtitle).trim();
  if (body.court !== undefined) board.court = String(body.court).trim();
  if (body.roundLabel !== undefined) board.roundLabel = String(body.roundLabel).trim();
  if (body.status !== undefined && ['idle', 'live', 'finished'].includes(body.status)) {
    board.status = body.status;
  }
  if (body.isVisible !== undefined) board.isVisible = Boolean(body.isVisible);
  if (body.linkedMatchId !== undefined) {
    board.linkedMatchId =
      body.linkedMatchId && mongoose.isValidObjectId(body.linkedMatchId) ? body.linkedMatchId : null;
    if (!board.linkedMatchId) board.linkedMatchFormat = null;
  }

  await saveBoardAndRespond(req, res, board, r.event._id);
});

/** 列出大會底下可載入的賽事場次 */
scoreboardApiRouter.get('/events/:eventId/scoreboard/matches', async (req, res) => {
  const r = await loadBoardForEvent(req.params.eventId);
  if (r.error) return res.status(r.status).json({ error: r.error });

  const tournaments = await Tournament.find({ eventId: r.event._id }).sort({ order: 1, createdAt: 1 }).lean();
  const tIds = tournaments.map((t) => t._id);
  const matches = await Match.find({ tournamentId: { $in: tIds } })
    .populate('teamA teamB')
    .sort({ scheduledTime: 1, createdAt: 1 })
    .lean();

  const tById = Object.fromEntries(tournaments.map((t) => [String(t._id), t]));
  const items = matches.map((m) => {
    const a = m.teamA?.name || '?';
    const b = m.teamB?.name || '?';
    const time = m.scheduledTime ? ` ${m.scheduledTime}` : '';
    const round = m.round ? ` · ${m.round}` : '';
    const court = m.court ? ` · ${m.court}` : '';
    return {
      id: String(m._id),
      tournamentId: String(m.tournamentId),
      tournamentName: tById[String(m.tournamentId)]?.name || '',
      label: `${a} vs ${b}${time}${round}${court}`,
      status: m.status,
    };
  });

  res.json({
    ok: true,
    tournaments: tournaments.map((t) => ({ id: String(t._id), name: t.name })),
    matches: items,
    linkedMatchId: r.board.linkedMatchId ? String(r.board.linkedMatchId) : null,
  });
});

/** 從賽程場次載入至計分牌 */
scoreboardApiRouter.post('/events/:eventId/scoreboard/load-match', async (req, res) => {
  const r = await loadBoardForEvent(req.params.eventId);
  if (r.error) return res.status(r.status).json({ error: r.error });

  const matchId = req.body?.matchId;
  if (!matchId || !mongoose.isValidObjectId(matchId)) {
    return res.status(400).json({ error: 'invalid_match_id' });
  }

  const match = await Match.findById(matchId).populate('teamA teamB').lean();
  if (!match) return res.status(404).json({ error: 'match_not_found' });

  const tournament = await Tournament.findById(match.tournamentId).lean();
  if (!tournament || String(tournament.eventId) !== String(r.event._id)) {
    return res.status(400).json({ error: 'match_not_in_event' });
  }

  const fields = scoreboardFieldsFromMatch(match, tournament);
  const board = r.board;
  Object.assign(board, fields);
  await saveBoardAndRespond(req, res, board, r.event._id, {
    match: { id: String(match._id), label: `${fields.teamAName} vs ${fields.teamBName}` },
  });
});

/** 快捷操作：加分、減分、重置等 */
scoreboardApiRouter.post('/events/:eventId/scoreboard/action', async (req, res) => {
  const r = await loadBoardForEvent(req.params.eventId);
  if (r.error) return res.status(r.status).json({ error: r.error });

  const action = String(req.body?.action || '');
  const board = r.board;

  switch (action) {
    case 'point_a':
      board.scoreA += 1;
      if (board.status === 'idle') board.status = 'live';
      break;
    case 'point_b':
      board.scoreB += 1;
      if (board.status === 'idle') board.status = 'live';
      break;
    case 'minus_a':
      board.scoreA = Math.max(0, board.scoreA - 1);
      break;
    case 'minus_b':
      board.scoreB = Math.max(0, board.scoreB - 1);
      break;
    case 'game_a':
      board.gamesA += 1;
      board.scoreA = 0;
      board.scoreB = 0;
      if (board.status === 'idle') board.status = 'live';
      maybeMarkScoreboardFinished(board);
      break;
    case 'game_b':
      board.gamesB += 1;
      board.scoreA = 0;
      board.scoreB = 0;
      if (board.status === 'idle') board.status = 'live';
      maybeMarkScoreboardFinished(board);
      break;
    case 'reset_game':
      board.scoreA = 0;
      board.scoreB = 0;
      break;
    case 'reset_all':
      board.scoreA = 0;
      board.scoreB = 0;
      board.gamesA = 0;
      board.gamesB = 0;
      board.status = 'idle';
      break;
    case 'finish':
      board.status = 'finished';
      break;
    case 'swap':
      [board.teamAName, board.teamBName] = [board.teamBName, board.teamAName];
      [board.scoreA, board.scoreB] = [board.scoreB, board.scoreA];
      [board.gamesA, board.gamesB] = [board.gamesB, board.gamesA];
      break;
    default:
      return res.status(400).json({ error: 'invalid_action' });
  }

  await saveBoardAndRespond(req, res, board, r.event._id);
});

/** 手動寫回賽程（完賽時通常已自動寫回，供補寫） */
scoreboardApiRouter.post('/events/:eventId/scoreboard/push-match', async (req, res) => {
  const r = await loadBoardForEvent(req.params.eventId);
  if (r.error) return res.status(r.status).json({ error: r.error });

  const board = r.board;
  if (!board.linkedMatchId) {
    return res.status(400).json({ error: 'no_linked_match', message: '請先從賽事載入場次' });
  }
  if (board.status !== 'finished') {
    board.status = 'finished';
  }

  const synced = await pushScoreboardToLinkedMatchIfFinished(req.app, board, r.event._id);
  if (!synced) return res.status(400).json({ error: 'push_failed' });

  res.json({ ok: true, matchSynced: true, matchEditUrl: synced.editUrl });
});
