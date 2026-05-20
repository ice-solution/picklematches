/**
 * 得分後發球權：由得分方發球。
 * 己方得分且已在發球 → 繼續發球；對手得分（side-out）→ 發球權轉到得分方。
 */
export function servingSideAfterPoint(scoringSide) {
  return scoringSide === 'b' ? 'b' : 'a';
}

export function normalizeServingSide(side) {
  return side === 'b' ? 'b' : 'a';
}

export function flipServingSide(side) {
  if (side === 'a') return 'b';
  if (side === 'b') return 'a';
  return 'a';
}
