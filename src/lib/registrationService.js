import mongoose from 'mongoose';
import { Member } from '../models/Member.js';
import { Division } from '../models/Division.js';
import { Registration } from '../models/Registration.js';
import { PaymentTransaction } from '../models/PaymentTransaction.js';
import { createWonderOrder } from './wonderPayment.js';
import { getSiteUrl } from './siteUrl.js';
import {
  checkMemberDivisionEligibility,
  countDivisionRegistrations,
  isDivisionRegistrationOpen,
} from './registrationEligibility.js';

export async function completeRegistrationPayment(registrationId) {
  const reg = await Registration.findById(registrationId);
  if (!reg) return null;
  if (reg.status === 'paid' || reg.status === 'confirmed') return reg;

  reg.status = 'paid';
  reg.amountPaid = reg.amountDue;
  await reg.save();

  await PaymentTransaction.updateMany(
    { registrationId: reg._id, status: 'pending' },
    { status: 'paid' }
  );

  return reg;
}

export async function startRegistrationCheckout({
  event,
  divisionId,
  primaryMemberId,
  partnerEmail,
  teamName,
  playerNames,
  contactPhone,
  remarks,
}) {
  if (!event.registrationEnabled) {
    return { ok: false, error: 'registration_disabled' };
  }

  const division = await Division.findOne({ _id: divisionId, eventId: event._id }).lean();
  if (!division) return { ok: false, error: 'division_not_found' };
  if (!isDivisionRegistrationOpen(division)) return { ok: false, error: 'registration_closed' };

  const primary = await Member.findById(primaryMemberId).lean();
  if (!primary) return { ok: false, error: 'login_required' };

  const memberIds = [primary._id];
  let partner = null;

  if (division.format === 'doubles') {
    const pe = String(partnerEmail || '')
      .trim()
      .toLowerCase();
    if (!pe) return { ok: false, error: 'partner_email_required' };
    partner = await Member.findOne({ email: pe }).lean();
    if (!partner) return { ok: false, error: 'partner_not_found' };
    if (String(partner._id) === String(primary._id)) {
      return { ok: false, error: 'partner_same_as_self' };
    }
    memberIds.push(partner._id);
  }

  for (const mid of memberIds) {
    const m = mid.equals(primary._id) ? primary : partner;
    const check = checkMemberDivisionEligibility(m, division);
    if (!check.ok) return { ok: false, error: 'eligibility_failed', issues: check.issues };
  }

  const taken = await countDivisionRegistrations(division._id);
  if (taken >= division.maxTeams) return { ok: false, error: 'division_full' };

  const fee = Number(division.fee) || 0;
  const registration = await Registration.create({
    eventId: event._id,
    divisionId: division._id,
    primaryMemberId: primary._id,
    memberIds,
    teamName: String(teamName || '').trim(),
    playerNames: String(playerNames || '').trim(),
    contactPhone: String(contactPhone || primary.phone || '').trim(),
    remarks: String(remarks || '').trim(),
    status: fee > 0 ? 'pending_payment' : 'paid',
    amountDue: fee,
    amountPaid: fee > 0 ? 0 : fee,
  });

  if (fee <= 0) {
    await PaymentTransaction.create({
      registrationId: registration._id,
      eventId: event._id,
      divisionId: division._id,
      memberIds,
      primaryMemberId: primary._id,
      amount: 0,
      currency: division.currency || 'HKD',
      paymentGateway: 'none',
      status: 'free',
    });
    return { ok: true, registration, free: true, redirectUrl: `/e/${event.slug}/register/success?id=${registration._id}` };
  }

  const txn = await PaymentTransaction.create({
    registrationId: registration._id,
    eventId: event._id,
    divisionId: division._id,
    memberIds,
    primaryMemberId: primary._id,
    amount: fee,
    currency: division.currency || 'HKD',
    paymentGateway: 'wonder',
    status: 'pending',
  });

  const baseUrl = getSiteUrl();
  const callbackUrl = `${baseUrl}/webhook/wonder`;
  const redirectUrl = `${baseUrl}/e/${event.slug}/register/success?id=${registration._id}`;

  const { paymentUrl, orderId } = await createWonderOrder({
    referenceNumber: txn._id.toString(),
    currency: division.currency || 'HKD',
    amount: fee,
    callbackUrl,
    redirectUrl,
    note: `${event.name} - ${division.name}`,
  });

  txn.wonderOrderId = orderId || txn._id.toString();
  await txn.save();

  return { ok: true, registration, paymentUrl };
}

export async function handleWonderWebhook(body, query) {
  const referenceNumber = body.reference_number || query.reference_number;
  const state = String(body.state || '').toLowerCase();
  const correspondenceState = String(body.correspondence_state || '').toLowerCase();
  const isPaid = state === 'completed' || correspondenceState === 'paid';

  if (!referenceNumber || !mongoose.isValidObjectId(referenceNumber)) {
    return { received: true, warning: 'invalid_reference' };
  }

  const txn = await PaymentTransaction.findById(referenceNumber);
  if (!txn) return { received: true, warning: 'transaction_not_found' };

  txn.transactionData = body;
  if (isPaid) {
    txn.status = 'paid';
    await txn.save();
    await completeRegistrationPayment(txn.registrationId);
  } else if (['cancelled', 'voided', 'failed'].includes(state)) {
    txn.status = 'failed';
    await txn.save();
    await Registration.findByIdAndUpdate(txn.registrationId, { status: 'failed' });
  } else {
    await txn.save();
  }

  return { received: true };
}
