import mongoose from 'mongoose';

const memberSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    gender: { type: String, enum: ['male', 'female', 'other', ''], default: '' },
    birthDate: { type: Date },
    duprRating: { type: Number, min: 0, max: 8 },
    /** 公開個人頁 /players/:profileSlug */
    profileSlug: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    bio: { type: String, default: '', trim: true },
    isProfilePublic: { type: Boolean, default: true },
  },
  { timestamps: true }
);

memberSchema.index({ email: 1 });

export const Member = mongoose.model('Member', memberSchema);
