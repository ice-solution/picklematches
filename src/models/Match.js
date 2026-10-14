import mongoose from 'mongoose';

/** bestOf5 | bestOf3 | singleGame | leagueFive（聯賽五回合 21 分） */
export const MATCH_FORMAT = {
  BEST_OF_5: 'bestOf5',
  BEST_OF_3: 'bestOf3',
  SINGLE_GAME: 'singleGame',
  LEAGUE_FIVE: 'leagueFive',
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
    /** 開賽時間僅「時:分」（24h）；聯賽每場可另設 scheduledDate */
    scheduledTime: { type: String, trim: true, default: '' },
    /** 此場日期 YYYY-MM-DD（聯賽跨週用；空白則跟賽事 competitionDate） */
    scheduledDate: { type: String, trim: true, default: '' },
    /** 舊資料相容；新資料請使用 scheduledTime */
    scheduledAt: { type: Date },
    status: {
      type: String,
      enum: ['scheduled', 'live', 'finished', 'postponed', 'cancelled'],
      default: 'scheduled',
    },
    /** 是否在公開網站顯示此場次（後台永遠可見） */
    showOnWebsite: { type: Boolean, default: true },
    /** 已完成之各局比分；聯賽另記出場球員與回合備註 */
    completedGames: [
      {
        a: { type: Number, min: 0 },
        b: { type: Number, min: 0 },
        label: { type: String, trim: true, default: '' },
        playersA: { type: [String], default: [] },
        playersB: { type: [String], default: [] },
        remark: { type: String, trim: true, default: '' },
        _id: false,
      },
    ],
    /** 目前進行中这一局：雙方分數（15 分制 + Deuce 無上限） */
    currentGameIndex: { type: Number, min: 0, default: 0 },
    currentPoints: {
      a: { type: Number, min: 0, default: 0 },
      b: { type: Number, min: 0, default: 0 },
    },
    /** 目前回合出場（聯賽；下一局時寫入 completedGames） */
    currentLineup: {
      playersA: { type: [String], default: [] },
      playersB: { type: [String], default: [] },
    },
    /** 整場備註（聯賽結果說明） */
    remark: { type: String, trim: true, default: '' },
    /**
     * 聯賽 iPad 排陣（一隊一頁；token 保密，對手睇唔到）
     * games[0..4] = 男雙／女雙／混雙×3，每格最多 2 名
     */
    lineupBySide: {
      a: {
        token: { type: String, trim: true, default: '' },
        confirmed: { type: Boolean, default: false },
        confirmedAt: { type: Date },
        games: [
          {
            players: { type: [String], default: [] },
            _id: false,
          },
        ],
      },
      b: {
        token: { type: String, trim: true, default: '' },
        confirmed: { type: Boolean, default: false },
        confirmedAt: { type: Date },
        games: [
          {
            players: { type: [String], default: [] },
            _id: false,
          },
        ],
      },
    },
    /** 目前發球方：a | b；空字串＝未指定 */
    serving: { type: String, enum: ['a', 'b', ''], default: '' },
    winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    /** 淘汰賽：完賽後勝者／敗者填入對應占位隊名（如 W-SF1、L-SF1） */
    knockoutWinnerSlot: { type: String, trim: true, default: null },
    knockoutLoserSlot: { type: String, trim: true, default: null },
    /**
     * 雙敗淘汰軌道：winners | losers | grand_final
     * 單敗／小組賽可為空
     */
    bracketTrack: {
      type: String,
      enum: ['', 'winners', 'losers', 'grand_final'],
      default: '',
    },
    /** 總決賽場次：1 = 第一場；2 = 若敗部反勝需再打（勝部一次優勢） */
    grandFinalLeg: { type: Number, min: 1, max: 2, default: null },
  },
  { timestamps: true }
);

matchSchema.index({ tournamentId: 1, scheduledDate: 1, scheduledTime: 1 });
matchSchema.index({ groupId: 1 });

export const Match = mongoose.model('Match', matchSchema);
