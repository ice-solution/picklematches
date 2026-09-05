import mongoose from 'mongoose';

const allianceMemberSchema = new mongoose.Schema(
  {
    allianceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alliance', required: true },
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    role: { type: String, enum: ['organizer', 'member'], default: 'member' },
    status: { type: String, enum: ['active', 'pending', 'left'], default: 'active' },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

allianceMemberSchema.index({ allianceId: 1, memberId: 1 }, { unique: true });
allianceMemberSchema.index({ memberId: 1, status: 1 });

export const AllianceMember = mongoose.model('AllianceMember', allianceMemberSchema);
