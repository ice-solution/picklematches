import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Member } from '../models/Member.js';
import { Registration } from '../models/Registration.js';
import { Division } from '../models/Division.js';
import { Event } from '../models/Event.js';
import { requireMember } from '../middleware/memberAuth.js';
import { uniqueSlug, normalizeSlugInput, isValidSlug } from '../lib/slugify.js';
import { getMemberAlliances } from '../lib/allianceService.js';
import { getSiteUrl } from '../lib/siteUrl.js';

export const memberRouter = Router();

memberRouter.get('/login', (req, res) => {
  if (req.session?.memberId) return res.redirect('/member');
  res.render('pages/member-login', {
    title: '會員登入',
    error: null,
    next: req.query.next || '',
  });
});

memberRouter.post('/login', async (req, res) => {
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();
  const password = String(req.body.password || '');
  const member = await Member.findOne({ email });
  if (!member || !(await bcrypt.compare(password, member.passwordHash))) {
    return res.status(401).render('pages/member-login', {
      title: '會員登入',
      error: '電郵或密碼不正確',
      next: req.body.next || '',
    });
  }
  req.session.memberId = member._id.toString();
  req.session.memberEmail = member.email;
  req.session.memberName = member.name;
  const next = req.body.next || '/member';
  res.redirect(next.startsWith('/') ? next : '/member');
});

memberRouter.get('/register', (req, res) => {
  if (req.session?.memberId) return res.redirect('/member');
  res.render('pages/member-register', {
    title: '會員註冊',
    error: null,
    next: req.query.next || '',
  });
});

memberRouter.post('/register', async (req, res) => {
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const gender = String(req.body.gender || '').trim();
  const birthDateRaw = String(req.body.birthDate || '').trim();
  const duprRaw = String(req.body.duprRating || '').trim();

  if (!email || !password || password.length < 6 || !name) {
    return res.status(400).render('pages/member-register', {
      title: '會員註冊',
      error: '請填寫姓名、電郵及至少 6 字密碼',
      next: req.body.next || '',
    });
  }

  const exists = await Member.findOne({ email }).lean();
  if (exists) {
    return res.status(400).render('pages/member-register', {
      title: '會員註冊',
      error: '此電郵已註冊，請直接登入',
      next: req.body.next || '',
    });
  }

  const duprRating = duprRaw ? parseFloat(duprRaw) : undefined;
  const member = await Member.create({
    email,
    passwordHash: await bcrypt.hash(password, 10),
    name,
    phone,
    gender: ['male', 'female', 'other'].includes(gender) ? gender : '',
    birthDate: birthDateRaw ? new Date(birthDateRaw) : undefined,
    duprRating: Number.isFinite(duprRating) ? duprRating : undefined,
    profileSlug: await uniqueSlug(name, async (s) => Boolean(await Member.findOne({ profileSlug: s }))),
    isProfilePublic: true,
  });

  req.session.memberId = member._id.toString();
  req.session.memberEmail = member.email;
  req.session.memberName = member.name;
  const next = req.body.next || '/member';
  res.redirect(next.startsWith('/') ? next : '/member');
});

memberRouter.post('/logout', (req, res) => {
  delete req.session.memberId;
  delete req.session.memberEmail;
  delete req.session.memberName;
  res.redirect('/');
});

memberRouter.get('/', requireMember, async (req, res, next) => {
  try {
    const member = await Member.findById(req.session.memberId).lean();
    if (!member) {
      delete req.session.memberId;
      return res.redirect('/member/login');
    }
    const regs = await Registration.find({ memberIds: member._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const divIds = [...new Set(regs.map((r) => String(r.divisionId)))];
    const eventIds = [...new Set(regs.map((r) => String(r.eventId)))];
    const [divisions, events] = await Promise.all([
      Division.find({ _id: { $in: divIds } }).lean(),
      Event.find({ _id: { $in: eventIds } }).lean(),
    ]);
    const divMap = Object.fromEntries(divisions.map((d) => [String(d._id), d]));
    const eventMap = Object.fromEntries(events.map((e) => [String(e._id), e]));

    res.render('pages/member-dashboard', {
      title: '我的報名',
      member,
      registrations: regs.map((r) => ({
        ...r,
        division: divMap[String(r.divisionId)],
        event: eventMap[String(r.eventId)],
      })),
    });
  } catch (e) {
    next(e);
  }
});

memberRouter.get('/profile', requireMember, async (req, res, next) => {
  try {
    const member = await Member.findById(req.session.memberId);
    if (!member) return res.redirect('/member/login');
    if (!member.profileSlug) {
      member.profileSlug = await uniqueSlug(member.name, async (s) =>
        Boolean(await Member.findOne({ profileSlug: s, _id: { $ne: member._id } }))
      );
      await member.save();
    }
    const memberLean = member.toObject();

    const alliances = await getMemberAlliances(member._id);
    const regs = await Registration.find({
      memberIds: member._id,
      status: { $in: ['paid', 'confirmed'] },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    const divIds = [...new Set(regs.map((r) => String(r.divisionId)))];
    const eventIds = [...new Set(regs.map((r) => String(r.eventId)))];
    const [divisions, events] = await Promise.all([
      Division.find({ _id: { $in: divIds } }).lean(),
      Event.find({ _id: { $in: eventIds } }).lean(),
    ]);
    const divMap = Object.fromEntries(divisions.map((d) => [String(d._id), d]));
    const eventMap = Object.fromEntries(events.map((e) => [String(e._id), e]));

    const profileUrl = member.profileSlug ? `${getSiteUrl()}/players/${member.profileSlug}` : '';

    res.render('pages/member-profile', {
      title: '我的資料',
      member,
      alliances,
      registrations: regs.map((r) => ({
        ...r,
        division: divMap[String(r.divisionId)],
        event: eventMap[String(r.eventId)],
      })),
      profileUrl,
      saved: req.query.saved === '1',
      error: req.query.error || null,
    });
  } catch (e) {
    next(e);
  }
});

memberRouter.post('/profile', requireMember, async (req, res, next) => {
  try {
    const member = await Member.findById(req.session.memberId);
    if (!member) return res.redirect('/member/login');

    member.name = String(req.body.name || member.name).trim() || member.name;
    member.phone = String(req.body.phone || '').trim();
    member.bio = String(req.body.bio || '').trim();
    member.gender = ['male', 'female', 'other', ''].includes(req.body.gender) ? req.body.gender : member.gender;
    const birthDateRaw = String(req.body.birthDate || '').trim();
    member.birthDate = birthDateRaw ? new Date(birthDateRaw) : member.birthDate;
    const duprRaw = String(req.body.duprRating || '').trim();
    const dupr = duprRaw ? parseFloat(duprRaw) : undefined;
    if (Number.isFinite(dupr)) member.duprRating = dupr;
    member.isProfilePublic = req.body.isProfilePublic === '1';

    const slugRaw = normalizeSlugInput(req.body.profileSlug || '');
    if (slugRaw && slugRaw !== member.profileSlug) {
      if (!isValidSlug(slugRaw)) return res.redirect('/member/profile?error=slug');
      const taken = await Member.findOne({ profileSlug: slugRaw, _id: { $ne: member._id } });
      if (taken) return res.redirect('/member/profile?error=slug_taken');
      member.profileSlug = slugRaw;
    }
    if (!member.profileSlug) {
      member.profileSlug = await uniqueSlug(member.name, async (s) =>
        Boolean(await Member.findOne({ profileSlug: s, _id: { $ne: member._id } }))
      );
    }

    await member.save();
    req.session.memberName = member.name;
    res.redirect('/member/profile?saved=1');
  } catch (e) {
    next(e);
  }
});
