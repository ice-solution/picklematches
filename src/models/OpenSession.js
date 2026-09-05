import mongoose from 'mongoose';

const openSessionSchema = new mongoose.Schema(
  {
    hostMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    allianceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alliance' },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    venue: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    sessionDate: { type: Date, required: true },
    sessionEndDate: { type: Date },
    format: { type: String, enum: ['singles', 'doubles', 'open'], default: 'open' },
    skillLevel: {
      type: String,
      enum: ['all', 'beginner', 'intermediate', 'advanced'],
      default: 'all',
    },
    maxPlayers: { type: Number, min: 2, default: 8 },
    participantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Member' }],
    status: {
      type: String,
      enum: ['open', 'full', 'cancelled', 'completed'],
      default: 'open',
    },
  },
  { timestamps: true }
);

openSessionSchema.index({ status: 1, sessionDate: 1 });
openSessionSchema.index({ hostMemberId: 1 });

export const OpenSession = mongoose.model('OpenSession', openSessionSchema);
