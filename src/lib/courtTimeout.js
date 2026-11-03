export const TIMEOUT_SECONDS = 60;
export const WARMUP_SECONDS = 120;
export const TIMEOUT_MAX_PER_SIDE = 2;

function ensureTimeouts(match) {
  if (!match.timeouts || typeof match.timeouts !== 'object') {
    match.timeouts = {
      usedA: 0,
      usedB: 0,
      activeSide: '',
      endsAt: null,
      durationSec: 0,
    };
  }
  if (match.timeouts.usedA == null) match.timeouts.usedA = 0;
  if (match.timeouts.usedB == null) match.timeouts.usedB = 0;
  if (match.timeouts.activeSide == null) match.timeouts.activeSide = '';
  if (match.timeouts.durationSec == null) match.timeouts.durationSec = 0;
  return match.timeouts;
}

function touch(match) {
  if (typeof match.markModified === 'function') match.markModified('timeouts');
}

function assertMatchPlayable(match) {
  if (!match || match.status === 'finished' || match.status === 'cancelled') {
    return { ok: false, error: 'match_ended' };
  }
  if (match.status !== 'live' && match.status !== 'scheduled') {
    return { ok: false, error: 'not_live' };
  }
  return { ok: true };
}

/** 若倒數已過期，清掉 active（唔減 used） */
export function clearExpiredTimeout(match) {
  const t = ensureTimeouts(match);
  if (!t.activeSide || !t.endsAt) return false;
  const ends = new Date(t.endsAt).getTime();
  if (!Number.isFinite(ends) || ends > Date.now()) return false;
  t.activeSide = '';
  t.endsAt = null;
  t.durationSec = 0;
  touch(match);
  return true;
}

/** 暫停或熱身進行中 */
export function isTimeoutActive(match) {
  clearExpiredTimeout(match);
  const t = ensureTimeouts(match);
  return !!(t.activeSide && t.endsAt && new Date(t.endsAt).getTime() > Date.now());
}

function startCountdown(match, activeSide, seconds) {
  const t = ensureTimeouts(match);
  t.activeSide = activeSide;
  t.durationSec = seconds;
  t.endsAt = new Date(Date.now() + seconds * 1000);
  if (match.status === 'scheduled') match.status = 'live';
  touch(match);
  return { ok: true, timeouts: { ...t, endsAt: t.endsAt } };
}

/**
 * 裁判呼叫暫停。每邊最多 2 次；進行中倒數時不可再 call。
 */
export function callTimeout(match, side) {
  const s = side === 'a' || side === 'A' ? 'a' : side === 'b' || side === 'B' ? 'b' : '';
  if (!s) return { ok: false, error: 'invalid_side' };
  const playable = assertMatchPlayable(match);
  if (!playable.ok) return playable;

  clearExpiredTimeout(match);
  const t = ensureTimeouts(match);
  if (t.activeSide) return { ok: false, error: 'timeout_active' };

  const usedKey = s === 'a' ? 'usedA' : 'usedB';
  const used = Number(t[usedKey] || 0);
  if (used >= TIMEOUT_MAX_PER_SIDE) return { ok: false, error: 'timeout_exhausted' };

  t[usedKey] = used + 1;
  return startCountdown(match, s, TIMEOUT_SECONDS);
}

/** 熱身倒數 2 分鐘（唔計入暫停次數） */
export function callWarmup(match) {
  const playable = assertMatchPlayable(match);
  if (!playable.ok) return playable;
  clearExpiredTimeout(match);
  const t = ensureTimeouts(match);
  if (t.activeSide) return { ok: false, error: 'timeout_active' };
  return startCountdown(match, 'warmup', WARMUP_SECONDS);
}

/** 手動取消進行中嘅暫停／熱身（唔改 used） */
export function cancelActiveTimeout(match) {
  clearExpiredTimeout(match);
  const t = ensureTimeouts(match);
  if (!t.activeSide) return { ok: false, error: 'no_active_timeout' };
  t.activeSide = '';
  t.endsAt = null;
  t.durationSec = 0;
  touch(match);
  return { ok: true, timeouts: { ...t } };
}

/** 抹走該邊已用暫停次數 1 次（顯示嘅 T） */
export function undoTimeoutUsed(match, side) {
  const s = side === 'a' || side === 'A' ? 'a' : side === 'b' || side === 'B' ? 'b' : '';
  if (!s) return { ok: false, error: 'invalid_side' };
  clearExpiredTimeout(match);
  const t = ensureTimeouts(match);
  const usedKey = s === 'a' ? 'usedA' : 'usedB';
  const used = Number(t[usedKey] || 0);
  if (used <= 0) return { ok: false, error: 'no_timeout_used' };
  // 若該邊暫停進行中，唔畀抹到 0 而仲顯示 active
  if (t.activeSide === s && used <= 1) {
    return { ok: false, error: 'timeout_active' };
  }
  t[usedKey] = used - 1;
  touch(match);
  return { ok: true, timeouts: { ...t, endsAt: t.endsAt } };
}
