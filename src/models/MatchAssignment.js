import mongoose from 'mongoose';

const matchAssignmentSchema = new mongoose.Schema(
  {
    matchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true },
    refereeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

matchAssignmentSchema.index({ matchId: 1, refereeId: 1 }, { unique: true });
matchAssignmentSchema.index({ refereeId: 1 });

export const MatchAssignment = mongoose.model('MatchAssignment', matchAssignmentSchema);
