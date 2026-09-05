import mongoose from 'mongoose';

const divisionSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    /** singles | doubles */
    format: { type: String, enum: ['singles', 'doubles'], default: 'doubles' },
    /** 每隊報名費（HKD） */
    fee: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: 'HKD', trim: true },
    maxTeams: { type: Number, min: 1, default: 32 },
    registrationOpen: { type: Date },
    registrationClose: { type: Date },
    order: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: true },
    restrictions: {
      minAge: { type: Number, min: 0 },
      maxAge: { type: Number, min: 0 },
      gender: { type: String, enum: ['male', 'female', 'mixed', 'open', ''], default: 'open' },
      minDupr: { type: Number, min: 0 },
      maxDupr: { type: Number, min: 0 },
    },
    eligibilityNotes: { type: String, default: '' },
    venueNote: { type: String, default: '' },
    linkedTournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament' },
  },
  { timestamps: true }
);

divisionSchema.index({ eventId: 1, order: 1 });
/** 一對一：每個賽事最多綁一個報名組別 */
divisionSchema.index(
  { linkedTournamentId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { linkedTournamentId: { $type: 'objectId' } } }
);

export const Division = mongoose.model('Division', divisionSchema);
