/** 公開網址根（Wonder callback、付款完成跳轉、郵件連結） */
export function getSiteUrl() {
  const raw = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
  if (raw) return raw;
  const port = process.env.PORT || '5239';
  return `http://localhost:${port}`;
}
