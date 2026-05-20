import mongoose from 'mongoose';

const displayContentSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    type: { type: String, trim: true, default: 'banner' },
    title: { type: String, trim: true, default: '' },
    body: { type: String, default: '' },
    imagePath: { type: String, trim: true, default: '' },
    order: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true }
);

displayContentSchema.index({ eventId: 1, order: 1 });

export const DisplayContent = mongoose.model('DisplayContent', displayContentSchema);
