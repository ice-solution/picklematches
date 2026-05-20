import mongoose from 'mongoose';

const slugHistorySchema = new mongoose.Schema(
  {
    slug: { type: String, required: true },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    slugAliases: { type: [String], default: [] },
    slugHistory: { type: [slugHistorySchema], default: [] },
    dateStart: { type: Date },
    dateEnd: { type: Date },
    venues: [{ type: String, trim: true }],
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

eventSchema.index({ slugAliases: 1 });

export const Event = mongoose.model('Event', eventSchema);
