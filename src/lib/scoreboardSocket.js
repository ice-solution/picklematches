import { LiveScoreboard } from '../models/LiveScoreboard.js';
import { normalizeScoreboardSlot } from '../models/LiveScoreboard.js';

/** 計分牌更新後推播至 Socket.io（直播顯示頁） */
export async function broadcastScoreboardUpdate(app, eventId, slot = 1, boardId = null) {
  const s = normalizeScoreboardSlot(slot);
  const board = boardId
    ? await LiveScoreboard.findById(boardId).lean()
    : await LiveScoreboard.findOne({ eventId, slot: s }).lean();
  if (!board) return null;
  const io = app.get('io');
  if (io) {
    const eid = eventId.toString();
    io.to(`scoreboard:${eid}:${s}`).emit('scoreboard:update', { scoreboard: board, slot: s });
  }
  return board;
}
