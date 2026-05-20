import { Event } from '../models/Event.js';

/** 依 :eventSlug 載入 Event，支援 slugAliases */
export async function loadEventBySlug(req, res, next) {
  const raw = req.params.eventSlug;
  if (!raw) return next();
  const slug = String(raw).toLowerCase().trim();
  try {
    const event = await Event.findOne({
      $or: [{ slug }, { slugAliases: slug }],
    }).lean();
    if (!event) {
      res.status(404).render('pages/error', {
        title: '找不到大會',
        message: '請確認網址是否正確。',
      });
      return;
    }
    req.event = event;
    next();
  } catch (e) {
    next(e);
  }
}
