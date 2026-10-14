import { formatDateDisplayZh, normalizeDateOnly } from './datetime.js';

/** 正規化為 24 小時制 "HH:mm"。支援 Excel 時間小數（0–1）、字串、舊版 Date。 */
export function normalizeTimeToHHmm(val) {
  if (val == null || val === '') return '';
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (val >= 0 && val < 1) {
      const totalMins = Math.round(val * 24 * 60);
      const h = Math.floor(totalMins / 60) % 24;
      const m = totalMins % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return `${String(val.getHours()).padStart(2, '0')}:${String(val.getMinutes()).padStart(2, '0')}`;
  }
  const str = String(val).trim();
  if (!str) return '';
  const hm = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const min = parseInt(hm[2], 10);
    if (h > 23 || min > 59) return '';
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }
  const d = new Date(str.replace(/\//g, '-'));
  if (!Number.isNaN(d.getTime())) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return '';
}

/** `<input type="time">` 的 value */
export function timeInputValueFromMatch(m) {
  if (!m) return '';
  if (m.scheduledTime && String(m.scheduledTime).trim()) return String(m.scheduledTime).trim();
  if (m.scheduledAt) return normalizeTimeToHHmm(m.scheduledAt);
  return '';
}

/** 前台／後台顯示：優先 scheduledTime，其次舊欄位 scheduledAt */
export function displayMatchTime(m) {
  if (!m) return '—';
  if (m.scheduledTime && String(m.scheduledTime).trim()) return String(m.scheduledTime).trim();
  if (m.scheduledAt) {
    const d = new Date(m.scheduledAt);
    if (!Number.isNaN(d.getTime())) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  return '—';
}

/** 此場日期：優先場次 scheduledDate，否則賽事 competitionDate */
export function matchScheduleDate(m) {
  if (!m) return '';
  return normalizeDateOnly(m.scheduledDate) || normalizeDateOnly(m.competitionDate) || '';
}

/** 賽程表：日期 + 時間 */
export function displayMatchSchedule(m) {
  if (!m) return '—';
  const time = displayMatchTime(m);
  const dateIso = matchScheduleDate(m);
  const date = dateIso ? formatDateDisplayZh(dateIso) || dateIso : '';
  if (date && time !== '—') return `${date} ${time}`;
  if (date) return date;
  if (time !== '—') return time;
  return '—';
}

export function compareMatchesBySchedule(a, b) {
  const da = matchScheduleDate(a);
  const db = matchScheduleDate(b);
  if (da !== db) {
    if (!da) return 1;
    if (!db) return -1;
    return da.localeCompare(db);
  }
  const ta = a.scheduledTime || '';
  const tb = b.scheduledTime || '';
  if (ta !== tb) {
    if (!ta) return 1;
    if (!tb) return -1;
    return ta.localeCompare(tb);
  }
  const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return ca - cb;
}
