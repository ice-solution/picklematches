/** 未寫入欄位的舊資料視為公開（showOnWebsite !== false） */

export function isShowOnWebsite(doc) {
  return !doc || doc.showOnWebsite !== false;
}

export function listedOnWebsiteQuery() {
  return { showOnWebsite: { $ne: false } };
}

export function parseShowOnWebsite(raw, defaultValue = true) {
  if (raw === undefined || raw === null) return defaultValue;
  if (Array.isArray(raw)) {
    if (!raw.length) return defaultValue;
    return parseShowOnWebsite(raw[raw.length - 1], defaultValue);
  }
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  const s = String(raw).trim().toLowerCase();
  if (s === '') return defaultValue;
  if (s === '1' || s === 'true' || s === 'on' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'off' || s === 'no') return false;
  return defaultValue;
}

export function filterPublicTournaments(tournaments) {
  return (tournaments || []).filter((t) => isShowOnWebsite(t));
}

export function filterPublicMatches(matches, tournaments) {
  const hiddenTids = new Set(
    (tournaments || []).filter((t) => !isShowOnWebsite(t)).map((t) => String(t._id))
  );
  return (matches || []).filter((m) => {
    if (!isShowOnWebsite(m)) return false;
    if (hiddenTids.has(String(m.tournamentId))) return false;
    return true;
  });
}
