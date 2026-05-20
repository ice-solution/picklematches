import mongoose from 'mongoose';

const liveScoreboardSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true, unique: true },
    teamAName: { type: String, default: '隊伍 A', trim: true },
    teamBName: { type: String, default: '隊伍 B', trim: true },
    scoreA: { type: Number, default: 0, min: 0 },
    scoreB: { type: Number, default: 0, min: 0 },
    /** 已贏局數（例如三局兩勝顯示 2-1） */
    gamesA: { type: Number, default: 0, min: 0 },
    gamesB: { type: Number, default: 0, min: 0 },
    subtitle: { type: String, default: '', trim: true },
    court: { type: String, default: '', trim: true },
    roundLabel: { type: String, default: '', trim: true },
    status: { type: String, enum: ['idle', 'live', 'finished'], default: 'idle' },
    /** 前台／OBS 是否顯示比分 */
    isVisible: { type: Boolean, default: true },
    /** 若從賽程載入，記錄來源場次以便同步比分 */
    linkedMatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    /** 連結場次的賽制（載入時快取，用於自動判斷完賽） */
    linkedMatchFormat: { type: String, default: null },
  },
  { timestamps: true }
);

export const LiveScoreboard = mongoose.model('LiveScoreboard', liveScoreboardSchema);

/** 取得或建立大會計分牌 */
export async function getOrCreateScoreboard(eventId) {
  let board = await LiveScoreboard.findOne({ eventId });
  if (!board) {
    board = await LiveScoreboard.create({ eventId });
  }
  return board;
}
