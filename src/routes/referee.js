import { Router } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { MatchAssignment } from '../models/MatchAssignment.js';
import { Match } from '../models/Match.js';
import { requireReferee } from '../middleware/auth.js';
import { normalizeLoginId, LOGIN_ID_RE } from '../lib/loginId.js';

export const refereeRouter = Router();

refereeRouter.get('/login', (req, res) => {
  if (req.session?.userId && req.session.role === 'referee') {
    return res.redirect('/referee');
  }
  res.render('pages/referee-login', { title: '球證登入', error: null, next: req.query.next || '' });
});

refereeRouter.post('/login', async (req, res) => {
  const loginId = normalizeLoginId(req.body.loginId);
  const password = String(req.body.password || '');
  if (!LOGIN_ID_RE.test(loginId)) {
    return res.status(400).render('pages/referee-login', {
      title: '球證登入',
      error: '請輸入有效的登入 ID（英數小寫開頭，3–32 字，可含 _ -）',
      next: req.body.next || '',
    });
  }
  const user = await User.findOne({ role: 'referee', loginId });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).render('pages/referee-login', {
      title: '球證登入',
      error: '登入 ID 或密碼錯誤',
      next: req.body.next || '',
    });
  }
  req.session.userId = user._id.toString();
  req.session.role = user.role;
  req.session.email = user.email;
  req.session.refLoginId = user.loginId || '';
  const next = req.body.next || '/referee';
  res.redirect(next.startsWith('/') ? next : '/referee');
});

refereeRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/referee/login');
  });
});

refereeRouter.get('/', requireReferee, async (req, res, next) => {
  try {
    const uid = new mongoose.Types.ObjectId(req.session.userId);
    const assigns = await MatchAssignment.find({ refereeId: uid })
      .populate({
        path: 'matchId',
        populate: [{ path: 'teamA' }, { path: 'teamB' }],
      })
      .sort({ createdAt: -1 })
      .lean();

    const matches = assigns.map((a) => a.matchId).filter(Boolean);
    res.render('pages/referee-matches', {
      title: '球證 — 我的場次',
      matches,
      userEmail: req.session.refLoginId || req.session.email,
    });
  } catch (e) {
    next(e);
  }
});

refereeRouter.get('/matches/:matchId', requireReferee, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    if (!mongoose.isValidObjectId(matchId)) {
      return res.status(404).send('無效場次');
    }
    const uid = new mongoose.Types.ObjectId(req.session.userId);
    const assigned = await MatchAssignment.findOne({ refereeId: uid, matchId });
    if (!assigned) {
      return res.status(403).send('未指派此場次給您的球證帳號');
    }
    const match = await Match.findById(matchId).populate('teamA teamB').lean();
    if (!match) return res.status(404).send('找不到場次');
    res.render('pages/referee-match', {
      title: '計分',
      match,
      matchId,
    });
  } catch (e) {
    next(e);
  }
});
