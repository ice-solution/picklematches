import mongoose from 'mongoose';

const slugHistorySchema = new mongoose.Schema(
  {
    slug: { type: String, required: true },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const venueSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    pinHash: { type: String, default: '' },
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
    /** 場地列表：{ slug, name, pinHash }；舊資料可能仍是字串，讀取時請用 normalizeEventVenues */
    venues: { type: [mongoose.Schema.Types.Mixed], default: [] },
    description: { type: String, default: '' },
    coverImageUrl: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true },
    registrationEnabled: { type: Boolean, default: false },
    registrationInfo: { type: String, default: '' },
    venueDetails: { type: String, default: '' },
    eligibilityNotes: { type: String, default: '' },
    /** 建立者；owner 角色只能管理自己的大會；admin/staff 可管理全部 */
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

eventSchema.index({ slugAliases: 1 });
eventSchema.index({ ownerId: 1 });

export const Event = mongoose.model('Event', eventSchema);
export { venueSchema };
