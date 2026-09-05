import mongoose from 'mongoose';

const paymentTransactionSchema = new mongoose.Schema(
  {
    registrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Registration', required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    divisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Division', required: true },
    memberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Member' }],
    primaryMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'HKD' },
    paymentGateway: { type: String, enum: ['wonder', 'none'], default: 'wonder' },
    wonderOrderId: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['pending', 'paid', 'failed', 'free'], default: 'pending' },
    transactionData: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

paymentTransactionSchema.index({ registrationId: 1 });
paymentTransactionSchema.index({ wonderOrderId: 1 });

export const PaymentTransaction = mongoose.model('PaymentTransaction', paymentTransactionSchema);
