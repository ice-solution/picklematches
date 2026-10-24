import { normalizeDateOnly } from './datetime.js';

const FALLBACK_COURT = '__default__';

/** 解析 HH:mm / HHmm / H:mm → 當日起分鐘數；無效回 null */
export function parseTimeToMinutes(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let h;
  let m;
  const colon = s.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2]);
  } else {
    const compact = s.match(/^(\d{1,2})(\d{2})$/);
    if (!compact) return null;
    h = Number(compact[1]);
    m = Number(compact[2]);
  }
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function formatMinutesAsTime(totalMinutes) {
  let mins = Number(totalMinutes);
  if (!Number.isFinite(mins)) mins = 0;
  // 跨日：繼續遞增顯示（最多滾到 23:59 後從 00:00 再計，保持字串 HH:mm）
  mins = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 從表單 body 解析排程參數。
 * @returns {{ enabled: boolean, startTime: string, slotMinutes: number, matchMinutes: number, restMinutes: number }}
 */
export function parseScheduleTimingBody(body = {}) {
  const startRaw = body.startTime ?? body.scheduleStartTime ?? '';
  const startMins = parseTimeToMinutes(startRaw);
  const matchMinutes = Math.max(1, parseInt(String(body.matchMinutes ?? body.matchDurationMins ?? '15'), 10) || 15);
  const restMinutes = Math.max(0, parseInt(String(body.restMinutes ?? body.restMins ?? '5'), 10) || 0);
  const slotMinutes = matchMinutes + restMinutes;
  if (startMins == null) {
    return {
      enabled: false,
      startTime: '',
      startMinutes: null,
      slotMinutes,
      matchMinutes,
      restMinutes,
    };
  }
  return {
    enabled: true,
    startTime: formatMinutesAsTime(startMins),
    startMinutes: startMins,
    slotMinutes,
    matchMinutes,
    restMinutes,
  };
}

/**
 * 每個場地獨立時間軸；多場地可同時開始。
 * @param {{ startMinutes?: number|null, startTime?: string, slotMinutes?: number, seedByCourt?: Record<string, string> }} opts
 *   seedByCourt：fillMissing 時，某 court 已有最晚時間（HH:mm），下一場從其後 slot 開始
 */
export function createCourtTimeAssigner({
  startMinutes = null,
  startTime = '',
  slotMinutes = 20,
  seedByCourt = null,
} = {}) {
  let base = startMinutes;
  if (base == null) base = parseTimeToMinutes(startTime);
  const enabled = base != null;
  const slot = Math.max(1, Number(slotMinutes) || 20);
  /** @type {Map<string, number>} */
  const cursors = new Map();

  if (enabled && seedByCourt && typeof seedByCourt === 'object') {
    for (const [court, t] of Object.entries(seedByCourt)) {
      const key = String(court || '').trim() || FALLBACK_COURT;
      const mins = parseTimeToMinutes(t);
      if (mins == null) continue;
      // 下一場 = 已有最晚開賽 + 一個 slot
      cursors.set(key, mins + slot);
    }
  }

  function keyFor(court) {
    const c = String(court || '').trim();
    return c || FALLBACK_COURT;
  }

  return {
    enabled,
    slotMinutes: slot,
    /** 佔場地：回傳時間並推進；skip=true（BYE）唔佔時間 */
    next(court, { skip = false } = {}) {
      if (!enabled || skip) return '';
      const key = keyFor(court);
      if (!cursors.has(key)) cursors.set(key, base);
      const at = cursors.get(key);
      cursors.set(key, at + slot);
      return formatMinutesAsTime(at);
    },
  };
}

/** 賽事比賽日（YYYY-MM-DD），無則 '' */
export function scheduleDateFromTournament(tournament) {
  return normalizeDateOnly(tournament?.competitionDate) || '';
}

/**
 * 由已有場次建立 court → 最晚 scheduledTime（用於 fillMissing 續排）
 */
export function latestTimeByCourt(matches) {
  /** @type {Record<string, number>} */
  const best = {};
  for (const m of matches || []) {
    const court = String(m.court || '').trim() || FALLBACK_COURT;
    const mins = parseTimeToMinutes(m.scheduledTime);
    if (mins == null) continue;
    if (best[court] == null || mins > best[court]) best[court] = mins;
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(best)) {
    out[k === FALLBACK_COURT ? '' : k] = formatMinutesAsTime(v);
  }
  return out;
}
