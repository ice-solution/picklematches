import mongoose from 'mongoose';

/** bestOf5 | bestOf3 | singleGame */
export const MATCH_FORMAT = {
  BEST_OF_5: 'bestOf5',
  BEST_OF_3: 'bestOf3',
  SINGLE_GAME: 'singleGame',
};

const matchSchema = new mongoose.Schema(
  {
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
    round: { type: String, trim: true, default: '' },
    matchFormat: {
      type: String,
      enum: Object.values(MATCH_FORMAT),
      required: true,
    },
    teamA: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
    teamB: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
    court: { type: String, trim: true, default: '' },
    /** 開賽時間僅「時:分」（24h），日期由大會設定 */
    scheduledTime: { type: String, trim: true, default: '' },
    /** 舊資料相容；新資料請使用 scheduledTime */
    scheduledAt: { type: Date },
    status: {
      type: String,
      enum: ['scheduled', 'live', 'finished', 'postponed', 'cancelled'],
      default: 'scheduled',
    },
    /** 已完成之各局比分 [ { a, b } ] */
    completedGames: [{ a: { type: Number, min: 0 }, b: { type: Number, min: 0 } }],
    /** 目前進行中这一局：雙方分數（15 分制 + Deuce 無上限） */
    currentGameIndex: { type: Number, min: 0, default: 0 },
    currentPoints: {
      a: { type: Number, min: 0, default: 0 },
      b: { type: Number, min: 0, default: 0 },
    },
    winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  },
  { timestamps: true }
);

matchSchema.index({ tournamentId: 1, scheduledTime: 1 });
matchSchema.index({ groupId: 1 });

export const Match = mongoose.model('Match', matchSchema);
