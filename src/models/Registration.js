import mongoose from 'mongoose';

const registrationSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    divisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Division', required: true },
    /** 提交報名嘅會員 */
    primaryMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    /** 參賽會員（單打 1 人、雙打 2 人） */
    memberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Member' }],
    teamName: { type: String, trim: true, default: '' },
    playerNames: { type: String, trim: true, default: '' },
    contactPhone: { type: String, trim: true, default: '' },
    remarks: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending_payment', 'paid', 'confirmed', 'cancelled', 'failed'],
      default: 'pending_payment',
    },
    amountDue: { type: Number, min: 0, default: 0 },
    amountPaid: { type: Number, min: 0, default: 0 },
    paymentDeadline: { type: Date },
    paymentEmailSentCount: { type: Number, min: 0, default: 0 },
    lastPaymentEmailAt: { type: Date },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  },
  { timestamps: true }
);

registrationSchema.index({ eventId: 1, divisionId: 1, status: 1 });
registrationSchema.index({ primaryMemberId: 1 });
registrationSchema.index({ memberIds: 1 });

export const Registration = mongoose.model('Registration', registrationSchema);
