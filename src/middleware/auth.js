import {
  BACKOFFICE_ROLES,
  ALLIANCE_REVIEW_ROLES,
} from '../lib/eventAccess.js';

export function requireAuth(roleAllow) {
  return (req, res, next) => {
    if (!req.session?.userId) {
      if (req.accepts('html')) {
        const back = req.originalUrl || '/';
        return res.redirect(`/admin/login?next=${encodeURIComponent(back)}`);
      }
      return res.status(401).json({ error: '未登入' });
    }
    if (roleAllow && !roleAllow.includes(req.session.role)) {
      if (req.accepts('html')) {
        return res.status(403).send('Forbidden');
      }
      return res.status(403).json({ error: '權限不足' });
    }
    next();
  };
}

export function requireReferee(req, res, next) {
  if (!req.session?.userId || req.session.role !== 'referee') {
    if (req.accepts('html')) {
      return res.redirect(`/referee/login?next=${encodeURIComponent(req.originalUrl || '/referee')}`);
    }
    return res.status(401).json({ error: '需球證登入' });
  }
  next();
}

/** 後台：admin / staff / owner */
export function requireStaff(req, res, next) {
  return requireAuth(BACKOFFICE_ROLES)(req, res, next);
}

/** 僅系統管理員 */
export function requireAdmin(req, res, next) {
  return requireAuth(['admin'])(req, res, next);
}

/** 聯盟審核：admin / staff（owner 不可） */
export function requireAllianceReview(req, res, next) {
  return requireAuth(ALLIANCE_REVIEW_ROLES)(req, res, next);
}

/** 裁判 API：一律 JSON */
export function requireRefereeApi(req, res, next) {
  if (!req.session?.userId || req.session.role !== 'referee') {
    return res.status(401).json({ error: '需球證登入' });
  }
  next();
}

export function requireStaffApi(req, res, next) {
  if (!req.session?.userId || !BACKOFFICE_ROLES.includes(req.session.role)) {
    return res.status(401).json({ error: '需管理端登入' });
  }
  next();
}
