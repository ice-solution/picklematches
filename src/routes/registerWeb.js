import { Router } from 'express';
import mongoose from 'mongoose';
import { loadEventBySlug } from '../middleware/loadEvent.js';
import { requireMember } from '../middleware/memberAuth.js';
import { Division } from '../models/Division.js';
import { Registration } from '../models/Registration.js';
import { Member } from '../models/Member.js';
import { countDivisionRegistrations, isDivisionRegistrationOpen } from '../lib/registrationEligibility.js';

export const registerWebRouter = Router({ mergeParams: true });

registerWebRouter.get('/:eventSlug/register', loadEventBySlug, requireMember, async (req, res, next) => {
  try {
    const event = req.event;
    if (!event.registrationEnabled) {
      return res.redirect(`/e/${event.slug}?error=registration_disabled`);
    }
    const member = await Member.findById(req.session.memberId).lean();
    if (!member) return res.redirect('/member/login');

    const divisions = await Division.find({ eventId: event._id, isPublished: true })
      .sort({ order: 1, createdAt: 1 })
      .lean();

    const counts = await Promise.all(
      divisions.map((d) => countDivisionRegistrations(d._id).then((n) => [String(d._id), n]))
    );
    const countByDiv = Object.fromEntries(counts);

    res.render('pages/event-register', {
      title: `${event.name} — 報名`,
      event,
      member,
      divisions: divisions.map((d) => ({
        ...d,
        registeredCount: countByDiv[String(d._id)] || 0,
        isOpen: isDivisionRegistrationOpen(d),
      })),
      error: req.query.error || null,
    });
  } catch (e) {
    next(e);
  }
});

registerWebRouter.get('/:eventSlug/register/success', loadEventBySlug, async (req, res, next) => {
  try {
    const id = String(req.query.id || '').trim();
    let registration = null;
    if (mongoose.isValidObjectId(id)) {
      registration = await Registration.findOne({ _id: id, eventId: req.event._id })
        .populate('divisionId')
        .lean();
    }
    res.render('pages/event-register-success', {
      title: '報名成功',
      event: req.event,
      registration,
    });
  } catch (e) {
    next(e);
  }
});
