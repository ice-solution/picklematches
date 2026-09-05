export function requireMember(req, res, next) {
  if (!req.session?.memberId) {
    const nextUrl = encodeURIComponent(req.originalUrl || '/member');
    return res.redirect(`/member/login?next=${nextUrl}`);
  }
  next();
}

export function requireMemberApi(req, res, next) {
  if (!req.session?.memberId) {
    return res.status(401).json({ error: 'login_required' });
  }
  next();
}
