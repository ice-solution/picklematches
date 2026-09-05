import mongoose from 'mongoose';

const allianceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: '' },
    logoUrl: { type: String, default: '' },
    website: { type: String, default: '' },
    contactEmail: { type: String, trim: true, default: '' },
    contactPhone: { type: String, trim: true, default: '' },
    location: { type: String, trim: true, default: '' },
    /** pending → 待審；approved → 已加盟並公開；rejected */
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    applicantMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectReason: { type: String, default: '' },
    isListed: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

allianceSchema.index({ status: 1, order: 1 });

export const Alliance = mongoose.model('Alliance', allianceSchema);
