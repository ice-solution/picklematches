import mongoose from 'mongoose';

const groupSchema = new mongoose.Schema(
  {
    tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
    name: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

groupSchema.index({ tournamentId: 1, order: 1 });

export const Group = mongoose.model('Group', groupSchema);
