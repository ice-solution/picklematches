import { Router } from 'express';
import { Member } from '../models/Member.js';
import { Registration } from '../models/Registration.js';
import { Division } from '../models/Division.js';
import { Event } from '../models/Event.js';
import { getMemberAlliances } from '../lib/allianceService.js';
import { getSiteUrl } from '../lib/siteUrl.js';

export const playerWebRouter = Router();

playerWebRouter.get('/', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = { isProfilePublic: true };
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { profileSlug: { $regex: q, $options: 'i' } },
      ];
    }
    const players = await Member.find(filter)
      .select('name profileSlug duprRating gender bio')
      .sort({ name: 1 })
      .limit(100)
      .lean();

    res.render('pages/players-index', {
      title: '球員列表',
      players,
      q,
    });
  } catch (e) {
    next(e);
  }
});

playerWebRouter.get('/:profileSlug', async (req, res, next) => {
  try {
    const member = await Member.findOne({
      profileSlug: req.params.profileSlug,
      isProfilePublic: true,
    }).lean();
    if (!member) {
      return res.status(404).render('pages/error', { title: '找不到球員', message: '此球員資料不存在或未公開。' });
    }

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

    const profileUrl = `${getSiteUrl()}/players/${member.profileSlug}`;

    res.render('pages/players-show', {
      title: member.name,
      member,
      alliances,
      registrations: regs.map((r) => ({
        ...r,
        division: divMap[String(r.divisionId)],
        event: eventMap[String(r.eventId)],
      })),
      profileUrl,
      isSelf: req.session?.memberId && String(req.session.memberId) === String(member._id),
    });
  } catch (e) {
    next(e);
  }
});
