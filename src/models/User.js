import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    /** 球證登入用（僅 referee 使用；唯一、小寫） */
    loginId: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      unique: true,
    },
    passwordHash: { type: String, required: true },
    name: { type: String, trim: true, default: '' },
    role: {
      type: String,
      enum: ['admin', 'staff', 'referee'],
      required: true,
    },
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
