import { LiveScoreboard } from '../models/LiveScoreboard.js';

/** 計分牌更新後推播至 Socket.io（直播顯示頁） */
export async function broadcastScoreboardUpdate(app, eventId) {
  const board = await LiveScoreboard.findOne({ eventId }).lean();
  if (!board) return null;
  const io = app.get('io');
  if (io) {
    const eid = eventId.toString();
    io.to(`scoreboard:${eid}`).emit('scoreboard:update', { scoreboard: board });
  }
  return board;
}
