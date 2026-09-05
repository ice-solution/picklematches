import { Router } from 'express';
import mongoose from 'mongoose';
import { Alliance } from '../models/Alliance.js';
import { AllianceMember } from '../models/AllianceMember.js';
import { Member } from '../models/Member.js';
import { requireMember } from '../middleware/memberAuth.js';
import { normalizeSlugInput, isValidSlug, uniqueSlug } from '../lib/slugify.js';
import { getMemberAlliances } from '../lib/allianceService.js';

export const allianceWebRouter = Router();

allianceWebRouter.get('/', async (req, res, next) => {
  try {
    const alliances = await Alliance.find({ status: 'approved', isListed: true })
      .sort({ order: 1, name: 1 })
      .lean();
    const counts = await AllianceMember.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$allianceId', n: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));

    res.render('pages/alliances-index', {
      title: '聯盟表',
      alliances: alliances.map((a) => ({ ...a, memberCount: countMap[String(a._id)] || 0 })),
    });
  } catch (e) {
    next(e);
  }
});

allianceWebRouter.get('/apply', requireMember, async (req, res, next) => {
  try {
    const pending = await Alliance.findOne({
      applicantMemberId: req.session.memberId,
      status: 'pending',
    }).lean();
    res.render('pages/alliances-apply', {
      title: '申請加盟聯盟',
      error: req.query.error || null,
      pending,
    });
  } catch (e) {
    next(e);
  }
});

allianceWebRouter.post('/apply', requireMember, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.redirect('/alliances/apply?error=name');

    const existingPending = await Alliance.findOne({
      applicantMemberId: req.session.memberId,
      status: 'pending',
    });
    if (existingPending) return res.redirect('/alliances/apply?error=pending');

    const slugInput = normalizeSlugInput(req.body.slug || name);
    const slug = await uniqueSlug(slugInput || name, async (s) => {
      if (!isValidSlug(s)) return true;
      return Boolean(await Alliance.findOne({ slug: s }));
    });

    await Alliance.create({
      name,
      slug,
      description: String(req.body.description || '').trim(),
      logoUrl: String(req.body.logoUrl || '').trim(),
      website: String(req.body.website || '').trim(),
      contactEmail: String(req.body.contactEmail || req.session.memberEmail || '').trim(),
      contactPhone: String(req.body.contactPhone || '').trim(),
      location: String(req.body.location || '').trim(),
      status: 'pending',
      applicantMemberId: req.session.memberId,
    });

    res.redirect('/member/alliances?applied=1');
  } catch (e) {
    next(e);
  }
});

allianceWebRouter.get('/:slug', async (req, res, next) => {
  try {
    const alliance = await Alliance.findOne({ slug: req.params.slug, status: 'approved' }).lean();
    if (!alliance) return res.status(404).render('pages/error', { title: '找不到聯盟', message: '此聯盟不存在或未通過審核。' });

    const memberships = await AllianceMember.find({ allianceId: alliance._id, status: 'active' })
      .sort({ role: 1, joinedAt: 1 })
      .lean();
    const memberIds = memberships.map((m) => m.memberId);
    const members = await Member.find({ _id: { $in: memberIds }, isProfilePublic: true })
      .select('name profileSlug duprRating')
      .lean();
    const memberMap = Object.fromEntries(members.map((m) => [String(m._id), m]));

    res.render('pages/alliances-show', {
      title: alliance.name,
      alliance,
      members: memberships
        .map((m) => ({ ...m, member: memberMap[String(m.memberId)] }))
        .filter((m) => m.member),
    });
  } catch (e) {
    next(e);
  }
});

/** 會員：我的聯盟 */
export const memberAllianceRouter = Router();

memberAllianceRouter.get('/alliances', requireMember, async (req, res, next) => {
  try {
    const member = await Member.findById(req.session.memberId).lean();
    const myAlliances = await getMemberAlliances(member._id);
    const myApplications = await Alliance.find({ applicantMemberId: member._id })
      .sort({ createdAt: -1 })
      .lean();

    let notice = null;
    if (req.query.applied === '1') notice = '已提交加盟申請，待大會審核。';

    res.render('pages/member-alliances', {
      title: '我的聯盟',
      member,
      myAlliances,
      myApplications,
      notice,
    });
  } catch (e) {
    next(e);
  }
});

memberAllianceRouter.post('/alliances/:allianceId/join', requireMember, async (req, res, next) => {
  try {
    const { allianceId } = req.params;
    if (!mongoose.isValidObjectId(allianceId)) return res.redirect('/member/alliances');
    const alliance = await Alliance.findOne({ _id: allianceId, status: 'approved' });
    if (!alliance) return res.redirect('/member/alliances');

    await AllianceMember.findOneAndUpdate(
      { allianceId: alliance._id, memberId: req.session.memberId },
      { allianceId: alliance._id, memberId: req.session.memberId, role: 'member', status: 'active', joinedAt: new Date() },
      { upsert: true }
    );
    res.redirect('/member/alliances?joined=1');
  } catch (e) {
    if (e.code === 11000) return res.redirect('/member/alliances');
    next(e);
  }
});
