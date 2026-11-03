export const TIMEOUT_SECONDS = 60;
export const TIMEOUT_MAX_PER_SIDE = 2;

function ensureTimeouts(match) {
  if (!match.timeouts || typeof match.timeouts !== 'object') {
    match.timeouts = { usedA: 0, usedB: 0, activeSide: '', endsAt: null };
  }
  if (match.timeouts.usedA == null) match.timeouts.usedA = 0;
  if (match.timeouts.usedB == null) match.timeouts.usedB = 0;
  if (match.timeouts.activeSide == null) match.timeouts.activeSide = '';
  return match.timeouts;
}

/** 若暫停已過期，清掉 active（唔減 used） */
export function clearExpiredTimeout(match) {
  const t = ensureTimeouts(match);
  if (!t.activeSide || !t.endsAt) return false;
  const ends = new Date(t.endsAt).getTime();
  if (!Number.isFinite(ends) || ends > Date.now()) return false;
  t.activeSide = '';
  t.endsAt = null;
  if (typeof match.markModified === 'function') match.markModified('timeouts');
  return true;
}

export function isTimeoutActive(match) {
  clearExpiredTimeout(match);
  const t = ensureTimeouts(match);
  return !!(t.activeSide && t.endsAt && new Date(t.endsAt).getTime() > Date.now());
}

/**
 * 裁判呼叫暫停。每邊最多 2 次；進行中暫停時不可再 call。
 */
export function callTimeout(match, side) {
  const s = side === 'a' || side === 'A' ? 'a' : side === 'b' || side === 'B' ? 'b' : '';
  if (!s) return { ok: false, error: 'invalid_side' };
  if (!match || match.status === 'finished' || match.status === 'cancelled') {
    return { ok: false, error: 'match_ended' };
  }
  if (match.status !== 'live' && match.status !== 'scheduled') {
    return { ok: false, error: 'not_live' };
  }

  clearExpiredTimeout(match);
  const t = ensureTimeouts(match);
  if (t.activeSide) return { ok: false, error: 'timeout_active' };

  const usedKey = s === 'a' ? 'usedA' : 'usedB';
  const used = Number(t[usedKey] || 0);
  if (used >= TIMEOUT_MAX_PER_SIDE) return { ok: false, error: 'timeout_exhausted' };

  t[usedKey] = used + 1;
  t.activeSide = s;
  t.endsAt = new Date(Date.now() + TIMEOUT_SECONDS * 1000);
  if (match.status === 'scheduled') match.status = 'live';
  if (typeof match.markModified === 'function') match.markModified('timeouts');
  return { ok: true, timeouts: { ...t, endsAt: t.endsAt } };
}
