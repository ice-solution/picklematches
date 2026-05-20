/** 供 `<input type="datetime-local">` 使用 */
export function toDatetimeLocalValue(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function parseDatetimeLocal(s) {
  if (!s || typeof s !== 'string') return undefined;
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}
