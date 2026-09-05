import { Router } from 'express';
import mongoose from 'mongoose';
import { Member } from '../models/Member.js';
import { OpenSession } from '../models/OpenSession.js';
import { Alliance } from '../models/Alliance.js';
import { requireMember } from '../middleware/memberAuth.js';
import { parseDatetimeLocal } from '../lib/datetime.js';
import { joinOpenSession, leaveOpenSession, syncOpenSessionStatus } from '../lib/openSessionService.js';
import { getMemberAlliances } from '../lib/allianceService.js';

export const openSessionWebRouter = Router();

const SKILL_LABELS = {
  all: '不限',
  beginner: '初學',
  intermediate: '中級',
  advanced: '進階',
};

const FORMAT_LABELS = {
  singles: '單打',
  doubles: '雙打',
  open: '自由配對',
};

openSessionWebRouter.get('/', async (req, res, next) => {
  try {
    const now = new Date();
    const sessions = await OpenSession.find({
      status: { $in: ['open', 'full'] },
      sessionDate: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    })
      .sort({ sessionDate: 1 })
      .limit(100)
      .lean();

    const hostIds = [...new Set(sessions.map((s) => String(s.hostMemberId)))];
    const hosts = await Member.find({ _id: { $in: hostIds } }).select('name profileSlug').lean();
    const hostMap = Object.fromEntries(hosts.map((h) => [String(h._id), h]));

    res.render('pages/sessions-index', {
      title: '開場列表',
      sessions: sessions.map((s) => ({
        ...s,
        host: hostMap[String(s.hostMemberId)],
        participantCount: (s.participantIds || []).length,
        skillLabel: SKILL_LABELS[s.skillLevel] || s.skillLevel,
        formatLabel: FORMAT_LABELS[s.format] || s.format,
      })),
      skillLabels: SKILL_LABELS,
      formatLabels: FORMAT_LABELS,
    });
  } catch (e) {
    next(e);
  }
});

openSessionWebRouter.get('/new', requireMember, async (req, res, next) => {
  try {
    const myAlliances = await getMemberAlliances(req.session.memberId);
    res.render('pages/sessions-new', {
      title: '開場',
      myAlliances,
      error: req.query.error || null,
    });
  } catch (e) {
    next(e);
  }
});

openSessionWebRouter.post('/new', requireMember, async (req, res, next) => {
  try {
    const title = String(req.body.title || '').trim();
    const sessionDate = parseDatetimeLocal(req.body.sessionDate);
    const maxPlayers = Math.max(2, Number(req.body.maxPlayers) || 8);

    if (!title || !sessionDate) return res.redirect('/sessions/new?error=1');

    const allianceId = String(req.body.allianceId || '').trim();
    let alliance = null;
    if (mongoose.isValidObjectId(allianceId)) {
      alliance = await Alliance.findOne({ _id: allianceId, status: 'approved' });
    }

    const session = await OpenSession.create({
      hostMemberId: req.session.memberId,
      allianceId: alliance?._id,
      title,
      description: String(req.body.description || '').trim(),
      venue: String(req.body.venue || '').trim(),
      address: String(req.body.address || '').trim(),
      sessionDate,
      sessionEndDate: parseDatetimeLocal(req.body.sessionEndDate) || undefined,
      format: ['singles', 'doubles', 'open'].includes(req.body.format) ? req.body.format : 'open',
      skillLevel: ['all', 'beginner', 'intermediate', 'advanced'].includes(req.body.skillLevel)
        ? req.body.skillLevel
        : 'all',
      maxPlayers,
      participantIds: [req.session.memberId],
      status: maxPlayers <= 1 ? 'full' : 'open',
    });

    res.redirect(`/sessions/${session._id}?created=1`);
  } catch (e) {
    next(e);
  }
});

openSessionWebRouter.get('/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!mongoose.isValidObjectId(sessionId)) return res.status(404).render('pages/error', { title: '找不到', message: '場次不存在。' });

    const openSession = await OpenSession.findById(sessionId).lean();
    if (!openSession) return res.status(404).render('pages/error', { title: '找不到', message: '場次不存在。' });

    const host = await Member.findById(openSession.hostMemberId).select('name profileSlug email phone').lean();
    const participants = await Member.find({ _id: { $in: openSession.participantIds || [] } })
      .select('name profileSlug duprRating')
      .lean();
    let alliance = null;
    if (openSession.allianceId) {
      alliance = await Alliance.findById(openSession.allianceId).select('name slug').lean();
    }

    const isJoined =
      req.session?.memberId &&
      (openSession.participantIds || []).some((id) => String(id) === String(req.session.memberId));
    const isHost = req.session?.memberId && String(openSession.hostMemberId) === String(req.session.memberId);

    res.render('pages/sessions-show', {
      title: openSession.title,
      openSession,
      host,
      participants,
      alliance,
      isJoined,
      isHost,
      skillLabel: SKILL_LABELS[openSession.skillLevel] || openSession.skillLevel,
      formatLabel: FORMAT_LABELS[openSession.format] || openSession.format,
      notice: req.query.created === '1' ? '開場成功！可分享連結邀請球友參加。' : null,
    });
  } catch (e) {
    next(e);
  }
});

openSessionWebRouter.post('/:sessionId/join', requireMember, async (req, res, next) => {
  try {
    const result = await joinOpenSession(req.params.sessionId, req.session.memberId);
    if (!result.ok) return res.redirect(`/sessions/${req.params.sessionId}?error=${result.error}`);
    res.redirect(`/sessions/${req.params.sessionId}?joined=1`);
  } catch (e) {
    next(e);
  }
});

openSessionWebRouter.post('/:sessionId/leave', requireMember, async (req, res, next) => {
  try {
    const result = await leaveOpenSession(req.params.sessionId, req.session.memberId);
    res.redirect(`/sessions/${req.params.sessionId}${result.ok ? '?left=1' : '?error=' + result.error}`);
  } catch (e) {
    next(e);
  }
});

openSessionWebRouter.post('/:sessionId/cancel', requireMember, async (req, res, next) => {
  try {
    const session = await OpenSession.findById(req.params.sessionId);
    if (!session || String(session.hostMemberId) !== String(req.session.memberId)) {
      return res.redirect(`/sessions/${req.params.sessionId}`);
    }
    session.status = 'cancelled';
    await session.save();
    res.redirect(`/sessions/${req.params.sessionId}?cancelled=1`);
  } catch (e) {
    next(e);
  }
});

export { SKILL_LABELS, FORMAT_LABELS };
