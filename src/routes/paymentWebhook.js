import { Router } from 'express';
import { handleWonderWebhook } from '../lib/registrationService.js';

export const paymentWebhookRouter = Router();

paymentWebhookRouter.get('/wonder', async (req, res, next) => {
  try {
    const result = await handleWonderWebhook(req.body || {}, req.query || {});
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
});

paymentWebhookRouter.post('/wonder', async (req, res, next) => {
  try {
    const result = await handleWonderWebhook(req.body || {}, req.query || {});
    res.status(200).json(result);
  } catch (e) {
    next(e);
  }
});
