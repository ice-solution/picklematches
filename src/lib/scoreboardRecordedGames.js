/** 贏局時把當局比分存入 recordedGames（在清零前呼叫） */
export function recordCurrentGameOnBoard(board) {
  const a = Math.max(0, Number(board.scoreA) || 0);
  const b = Math.max(0, Number(board.scoreB) || 0);
  if (a === 0 && b === 0) return;
  if (!board.recordedGames) board.recordedGames = [];
  board.recordedGames.push({ a, b });
  board.markModified('recordedGames');
}

export function clearRecordedGames(board) {
  board.recordedGames = [];
  board.markModified('recordedGames');
}

export function swapRecordedGames(board) {
  if (!board.recordedGames?.length) return;
  board.recordedGames = board.recordedGames.map((g) => ({ a: g.b, b: g.a }));
  board.markModified('recordedGames');
}
