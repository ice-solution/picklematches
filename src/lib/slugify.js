const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeSlugInput(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isValidSlug(slug) {
  return SLUG_RE.test(slug) && slug.length >= 2 && slug.length <= 64;
}

/** 產生唯一 slug，衝突時加數字後綴 */
export async function uniqueSlug(base, existsFn, maxTry = 50) {
  let slug = normalizeSlugInput(base);
  if (!slug) slug = 'item';
  if (!(await existsFn(slug))) return slug;
  for (let i = 2; i <= maxTry; i++) {
    const candidate = `${slug}-${i}`;
    if (!(await existsFn(candidate))) return candidate;
  }
  return `${slug}-${Date.now().toString(36)}`;
}
