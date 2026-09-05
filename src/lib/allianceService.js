import { Alliance } from '../models/Alliance.js';
import { AllianceMember } from '../models/AllianceMember.js';

export async function getMemberAlliances(memberId) {
  const memberships = await AllianceMember.find({ memberId, status: 'active' })
    .sort({ joinedAt: -1 })
    .lean();
  const allianceIds = memberships.map((m) => m.allianceId);
  const alliances = await Alliance.find({ _id: { $in: allianceIds }, status: 'approved' }).lean();
  const allianceMap = Object.fromEntries(alliances.map((a) => [String(a._id), a]));
  return memberships
    .map((m) => ({
      ...m,
      alliance: allianceMap[String(m.allianceId)],
    }))
    .filter((m) => m.alliance);
}

export async function approveAlliance(allianceId, adminUserId) {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) return null;
  alliance.status = 'approved';
  alliance.reviewedAt = new Date();
  alliance.reviewedBy = adminUserId;
  alliance.rejectReason = '';
  await alliance.save();

  if (alliance.applicantMemberId) {
    await AllianceMember.findOneAndUpdate(
      { allianceId: alliance._id, memberId: alliance.applicantMemberId },
      {
        allianceId: alliance._id,
        memberId: alliance.applicantMemberId,
        role: 'organizer',
        status: 'active',
        joinedAt: new Date(),
      },
      { upsert: true, new: true }
    );
  }
  return alliance;
}

export async function rejectAlliance(allianceId, adminUserId, reason = '') {
  const alliance = await Alliance.findById(allianceId);
  if (!alliance) return null;
  alliance.status = 'rejected';
  alliance.reviewedAt = new Date();
  alliance.reviewedBy = adminUserId;
  alliance.rejectReason = String(reason || '').trim();
  await alliance.save();
  return alliance;
}
