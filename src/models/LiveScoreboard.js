import mongoose from 'mongoose';

const liveScoreboardSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    /** 1 = 主場地直播／場地1，2 = 第二面計分牌 */
    slot: { type: Number, default: 1, min: 1, max: 2 },
    teamAName: { type: String, default: '隊伍 A', trim: true },
    teamBName: { type: String, default: '隊伍 B', trim: true },
    scoreA: { type: Number, default: 0, min: 0 },
    scoreB: { type: Number, default: 0, min: 0 },
    gamesA: { type: Number, default: 0, min: 0 },
    gamesB: { type: Number, default: 0, min: 0 },
    /** 每局結束時記錄的真實比分（供寫回賽程與畫鬼腳細分） */
    recordedGames: [{ a: { type: Number, min: 0 }, b: { type: Number, min: 0 } }],
    subtitle: { type: String, default: '', trim: true },
    court: { type: String, default: '', trim: true },
    roundLabel: { type: String, default: '', trim: true },
    status: { type: String, enum: ['idle', 'live', 'finished'], default: 'idle' },
    isVisible: { type: Boolean, default: true },
    linkedMatchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    linkedMatchFormat: { type: String, default: null },
    servingSide: { type: String, enum: ['a', 'b'], default: 'a' },
  },
  { timestamps: true }
);

liveScoreboardSchema.index({ eventId: 1, slot: 1 }, { unique: true });

export const LiveScoreboard = mongoose.model('LiveScoreboard', liveScoreboardSchema);

export function normalizeScoreboardSlot(slot) {
  return Number(slot) === 2 ? 2 : 1;
}

/** 取得或建立大會計分牌（slot 1 或 2） */
export async function getOrCreateScoreboard(eventId, slot = 1) {
  const s = normalizeScoreboardSlot(slot);
  let board = await LiveScoreboard.findOne({ eventId, slot: s });
  if (!board && s === 1) {
    const legacy = await LiveScoreboard.findOne({ eventId, slot: { $exists: false } });
    if (legacy) {
      legacy.slot = 1;
      await legacy.save();
      board = legacy;
    }
  }
  if (!board) {
    try {
      board = await LiveScoreboard.create({ eventId, slot: s });
    } catch (err) {
      if (err?.code === 11000 && s === 2) {
        board = await LiveScoreboard.findOne({ eventId, slot: 2 });
      }
      if (!board) throw err;
    }
  }
  return board;
}
