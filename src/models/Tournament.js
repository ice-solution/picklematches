import mongoose from 'mongoose';

const tournamentSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true, trim: true },
    /** group: 小組賽, knockout: 淘汰賽 — 同一 Event 下可有多筆 */
    phase: { type: String, enum: ['group', 'knockout'], required: true },
    /** 淘汰賽對應的小組賽賽事（產生淘汰或後台綁定） */
    sourceGroupTournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tournament',
      default: null,
    },
    /** 各組取前 N 名晉級（不含最佳第三名） */
    advancePerGroup: { type: Number, min: 1, default: 2 },
    /**
     * 小組名次積分（用於「小組後淘汰」常見規則）
     * 預設：勝 +1、負 -1
     */
    groupWinPoints: { type: Number, default: 1 },
    groupLossPoints: { type: Number, default: -1 },
    order: { type: Number, default: 0 },
    /** 比賽日期 YYYY-MM-DD（前台賽程顯示用） */
    competitionDate: { type: String, trim: true, default: '' },
  },
  { timestamps: true }
);

tournamentSchema.index({ eventId: 1, phase: 1 });

export const Tournament = mongoose.model('Tournament', tournamentSchema);
