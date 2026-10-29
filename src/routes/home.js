import { Router } from 'express';
import { Event } from '../models/Event.js';
import { Alliance } from '../models/Alliance.js';
import { Member } from '../models/Member.js';
import { OpenSession } from '../models/OpenSession.js';

export const homeRouter = Router();

/** VANITY_HOST_REDIRECTS=match.gpcchkmo.org=/e/gpcc-1?date=...&comp=... */
function vanityRedirectPath(req) {
  const raw = String(process.env.VANITY_HOST_REDIRECTS || '').trim();
  if (!raw) return null;
  const host = String(req.get('x-forwarded-host') || req.get('host') || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');
  if (!host) return null;
  for (const part of raw.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const h = part.slice(0, idx).trim().toLowerCase();
    const target = part.slice(idx + 1).trim();
    if (h === host && target.startsWith('/')) return target;
  }
  return null;
}

homeRouter.get('/', async (req, res, next) => {
  try {
    const vanity = vanityRedirectPath(req);
    if (vanity) {
      return res.redirect(302, vanity);
    }
    const [events, alliances, players, openSessions] = await Promise.all([
      Event.find({ isActive: true }).sort({ dateStart: -1, createdAt: -1 }).lean(),
      Alliance.find({ status: 'approved', isListed: true }).sort({ order: 1, name: 1 }).limit(6).lean(),
      Member.find({ isProfilePublic: true }).select('name profileSlug duprRating').sort({ name: 1 }).limit(8).lean(),
      OpenSession.find({ status: { $in: ['open', 'full'] }, sessionDate: { $gte: new Date() } })
        .sort({ sessionDate: 1 })
        .limit(5)
        .lean(),
    ]);
    res.render('pages/home', { title: '匹克球比賽平台', events, alliances, players, openSessions });
  } catch (e) {
    next(e);
  }
});

homeRouter.get('/events', async (req, res, next) => {
  try {
    const events = await Event.find({ isActive: true }).sort({ dateStart: -1, createdAt: -1 }).lean();
    res.render('pages/events-index', { title: '比賽列表', events });
  } catch (e) {
    next(e);
  }
});
