import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema(
  {
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
    name: { type: String, required: true, trim: true },
    /** 隊伍編號，如 A1、B2（同組內依序） */
    code: { type: String, trim: true, default: '' },
    seed: { type: Number, min: 0 },
    /** 淘汰賽產生：對應小組賽原隊伍（可選） */
    sourceTeamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    /** 系統占位隊伍（TBD/BYE） */
    isPlaceholder: { type: Boolean, default: false },
    /** 報到／已登記 */
    checkedIn: { type: Boolean, default: false },
  },
  { timestamps: true }
);

teamSchema.index({ tournamentId: 1, groupId: 1 });
teamSchema.index({ tournamentId: 1, code: 1 });
teamSchema.index({ tournamentId: 1, sourceTeamId: 1 });

export const Team = mongoose.model('Team', teamSchema);
