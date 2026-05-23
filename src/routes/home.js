import { Router } from 'express';

export const homeRouter = Router();

/** 例：/e/match-ap-2026#standings（由 HOME_REDIRECT 設定） */
function homeRedirectTarget() {
  const raw = String(process.env.HOME_REDIRECT || '').trim();
  if (!raw) return '';
  if (raw.startsWith('/')) return raw;
  return `/${raw.replace(/^\/+/, '')}`;
}

homeRouter.get('/', (req, res) => {
  const target = homeRedirectTarget();
  if (target) return res.redirect(302, target);
  res.render('pages/home', { title: '匹克球比賽平台' });
});
