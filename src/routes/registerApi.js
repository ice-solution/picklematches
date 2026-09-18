import { Router } from 'express';
import { loadEventBySlug } from '../middleware/loadEvent.js';
import { startRegistrationCheckout } from '../lib/registrationService.js';

export const registerApiRouter = Router({ mergeParams: true });

registerApiRouter.post('/register/:eventSlug/checkout', loadEventBySlug, async (req, res, next) => {
  try {
    const result = await startRegistrationCheckout({
      event: req.event,
      divisionId: req.body?.divisionId,
      primaryMemberId: req.session?.memberId || undefined,
      contactName: req.body?.contactName,
      contactEmail: req.body?.contactEmail,
      partnerEmail: req.body?.partnerEmail,
      teamName: req.body?.teamName,
      playerNames: req.body?.playerNames,
      contactPhone: req.body?.contactPhone,
      remarks: req.body?.remarks,
    });

    if (!result.ok) {
      const status = result.error === 'division_full' ? 409 : 400;
      return res.status(status).json({
        error: result.error,
        issues: result.issues || undefined,
      });
    }

    if (result.free) {
      return res.json({ ok: true, redirectUrl: result.redirectUrl });
    }

    res.json({ ok: true, url: result.paymentUrl });
  } catch (e) {
    next(e);
  }
});
