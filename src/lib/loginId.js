/** 球證登入 ID：英數小寫開頭，可含數字、底線、連字號，3–32 字 */
export const LOGIN_ID_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

export function normalizeLoginId(raw) {
  return String(raw || '').trim().toLowerCase();
}
