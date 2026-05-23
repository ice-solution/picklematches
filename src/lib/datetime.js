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

/** 正規化為 YYYY-MM-DD */
export function normalizeDateOnly(val) {
  if (!val) return '';
  const str = String(val).trim();
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(str.replace(/\//g, '-'));
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 前台顯示：2025年5月24日（星期六） */
export function formatDateDisplayZh(dateStr) {
  const iso = normalizeDateOnly(dateStr);
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const w = weekdays[dt.getDay()];
  return `${y}年${m}月${d}日（星期${w}）`;
}
