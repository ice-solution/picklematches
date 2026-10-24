import bcrypt from 'bcryptjs';

/** 場地 slug：允許單字元數字，例如 1、2、court-a */
const VENUE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeVenueSlug(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isValidVenueSlug(slug) {
  const s = String(slug || '');
  return VENUE_SLUG_RE.test(s) && s.length >= 1 && s.length <= 32;
}

/** 從顯示名稱推斷 slug（「1 號場」→「1」） */
export function slugFromVenueName(name, fallbackIndex = 0) {
  const raw = String(name || '').trim();
  const digit = raw.match(/^(\d+)/);
  if (digit) return digit[1];
  const slug = normalizeVenueSlug(raw);
  if (slug) return slug;
  return String(fallbackIndex + 1);
}

/**
 * 將舊字串陣列或混和資料正規成場地物件
 * @returns {{ slug: string, name: string, pinHash: string, streamRtspUrl: string, youtubeRtmpServer: string, youtubeStreamKey: string }[]}
 */
export function normalizeEventVenues(venues) {
  if (!Array.isArray(venues)) return [];
  const out = [];
  const seen = new Set();
  venues.forEach((v, i) => {
    let slug = '';
    let name = '';
    let pinHash = '';
    let streamRtspUrl = '';
    let youtubeRtmpServer = '';
    let youtubeStreamKey = '';
    if (v && typeof v === 'object') {
      name = String(v.name || '').trim();
      slug = normalizeVenueSlug(v.slug) || slugFromVenueName(name || v.slug, i);
      pinHash = typeof v.pinHash === 'string' ? v.pinHash : '';
      streamRtspUrl = String(v.streamRtspUrl || '').trim();
      youtubeRtmpServer = String(v.youtubeRtmpServer || '').trim();
      youtubeStreamKey = String(v.youtubeStreamKey || '').trim();
      if (!name) name = slug ? slug + ' 號場' : '場地 ' + (i + 1);
    } else {
      name = String(v || '').trim();
      if (!name) return;
      slug = slugFromVenueName(name, i);
    }
    if (!isValidVenueSlug(slug)) return;
    if (seen.has(slug)) return;
    seen.add(slug);
    out.push({
      slug,
      name,
      pinHash,
      streamRtspUrl,
      youtubeRtmpServer,
      youtubeStreamKey,
    });
  });
  return out;
}

/** 產生賽程用：回傳 slug 陣列 */
export function venueSlugList(venues) {
  return normalizeEventVenues(venues).map((v) => v.slug);
}

/**
 * 從產生賽程表單勾選嘅 courts[] 解析要用嘅場地 slug。
 * 無勾選／未傳 → null（呼叫端用大會全部場地）；
 * 有勾選 → 只回傳大會場地內有效嘅 slug（維持大會順序）。
 */
export function parseSelectedCourtsFromBody(body, eventVenues) {
  const allowed = venueSlugList(eventVenues);
  if (!allowed.length) return [];
  const raw = body?.courts ?? body?.court;
  if (raw == null || raw === '') return null;
  const picked = new Set(
    (Array.isArray(raw) ? raw : [raw]).map((s) => String(s || '').trim()).filter(Boolean)
  );
  if (!picked.size) return null;
  return allowed.filter((slug) => picked.has(slug));
}

export function findVenue(venues, courtKey) {
  const key = String(courtKey || '').trim();
  if (!key) return null;
  const list = normalizeEventVenues(venues);
  const bySlug = list.find((v) => v.slug === normalizeVenueSlug(key) || v.slug === key);
  if (bySlug) return bySlug;
  return list.find((v) => v.name === key) || null;
}

/** 顯示用場地名；找不到則回傳原 court 字串 */
export function venueLabel(venues, courtKey) {
  const key = String(courtKey || '').trim();
  if (!key) return '';
  const v = findVenue(venues, key);
  return v ? v.name : key;
}

/** Match.court 查詢條件（相容舊資料存名稱） */
export function courtMatchFilter(venue) {
  if (!venue) return { court: '__none__' };
  const or = [{ court: venue.slug }];
  if (venue.name && venue.name !== venue.slug) or.push({ court: venue.name });
  return { $or: or };
}

/**
 * 從表單 body 解析場地列。
 * 支援 venueSlug[] / venueName[] / venuePin[] / stream 欄位，或舊版 textarea venues。
 */
export async function parseVenuesFromBody(body, existing = []) {
  const existingBySlug = new Map(normalizeEventVenues(existing).map((v) => [v.slug, v]));

  const slugs = body?.venueSlug;
  const names = body?.venueName;
  const pins = body?.venuePin;
  const rtsps = body?.venueStreamRtsp;
  const rtmps = body?.venueYoutubeRtmp;
  const keys = body?.venueYoutubeKey;

  if (slugs !== undefined || names !== undefined) {
    const slugArr = Array.isArray(slugs) ? slugs : slugs != null ? [slugs] : [];
    const nameArr = Array.isArray(names) ? names : names != null ? [names] : [];
    const pinArr = Array.isArray(pins) ? pins : pins != null ? [pins] : [];
    const rtspArr = Array.isArray(rtsps) ? rtsps : rtsps != null ? [rtsps] : [];
    const rtmpArr = Array.isArray(rtmps) ? rtmps : rtmps != null ? [rtmps] : [];
    const keyArr = Array.isArray(keys) ? keys : keys != null ? [keys] : [];
    const n = Math.max(slugArr.length, nameArr.length);
    const out = [];
    const seen = new Set();

    for (let i = 0; i < n; i++) {
      const name = String(nameArr[i] || '').trim();
      let slug = normalizeVenueSlug(slugArr[i]) || slugFromVenueName(name, i);
      if (!name && !slug) continue;
      if (!isValidVenueSlug(slug)) {
        const err = new Error('invalid_venue_slug');
        err.slug = slugArr[i];
        throw err;
      }
      if (seen.has(slug)) {
        const err = new Error('duplicate_venue_slug');
        err.slug = slug;
        throw err;
      }
      seen.add(slug);
      const prev = existingBySlug.get(slug);
      const pinRaw = String(pinArr[i] ?? '').trim();
      let pinHash = prev?.pinHash || '';
      if (pinRaw) {
        pinHash = await bcrypt.hash(pinRaw, 10);
      }

      const rtspRaw = String(rtspArr[i] ?? '').trim();
      const rtmpRaw = String(rtmpArr[i] ?? '').trim();
      const keyRaw = String(keyArr[i] ?? '').trim();

      out.push({
        slug,
        name: name || slug + ' 號場',
        pinHash,
        streamRtspUrl: rtspRaw,
        youtubeRtmpServer: rtmpRaw,
        // 金鑰同 PIN：留空＝維持原值；填「-」可清除
        youtubeStreamKey: keyRaw === '-' ? '' : keyRaw || prev?.youtubeStreamKey || '',
      });
    }
    return out;
  }

  const lines = String(body?.venues || '')
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i];
    const slug = slugFromVenueName(name, i);
    if (!isValidVenueSlug(slug) || seen.has(slug)) continue;
    seen.add(slug);
    const prev =
      existingBySlug.get(slug) ||
      [...existingBySlug.values()].find((v) => v.name === name);
    out.push({
      slug,
      name,
      pinHash: prev?.pinHash || '',
      streamRtspUrl: prev?.streamRtspUrl || '',
      youtubeRtmpServer: prev?.youtubeRtmpServer || '',
      youtubeStreamKey: prev?.youtubeStreamKey || '',
    });
  }
  return out;
}

export async function verifyVenuePin(venue, pin) {
  if (!venue?.pinHash) return false;
  const raw = String(pin || '');
  if (!raw) return false;
  return bcrypt.compare(raw, venue.pinHash);
}
