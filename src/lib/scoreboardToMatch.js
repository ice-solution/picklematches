import { gamesNeededToWinMatch } from './scoring.js';

const BOARD_TO_MATCH_STATUS = {
  idle: 'scheduled',
  live: 'live',
  finished: 'finished',
};

/**
 * 將大會計分牌資料寫回賽程場次（需已連結 linkedMatchId）。
 * 計分牌只記錄「贏了幾局」，已完成局會以 15-0 摘要寫入（不含每局細部分數）。
 * @returns {{ ok: true, warnings: string[] }}
 */
export function applyScoreboardToMatch(match, board) {
  const warnings = [];
  const scoreA = Math.max(0, Number(board.scoreA) || 0);
  const scoreB = Math.max(0, Number(board.scoreB) || 0);
  const gamesA = Math.max(0, Number(board.gamesA) || 0);
  const gamesB = Math.max(0, Number(board.gamesB) || 0);

  match.currentPoints = { a: scoreA, b: scoreB };

  const completed = [];
  for (let i = 0; i < gamesA; i++) completed.push({ a: 15, b: 0 });
  for (let i = 0; i < gamesB; i++) completed.push({ a: 0, b: 15 });
  if (completed.length > 0) {
    warnings.push('completed_games_summary');
  }
  match.completedGames = completed;
  match.currentGameIndex = completed.length;

  if (board.court) match.court = String(board.court).trim();
  if (board.roundLabel) match.round = String(board.roundLabel).trim();

  const need = gamesNeededToWinMatch(match.matchFormat);
  let status = BOARD_TO_MATCH_STATUS[board.status] || 'scheduled';

  if (scoreA > 0 || scoreB > 0 || gamesA > 0 || gamesB > 0) {
    if (status === 'scheduled') status = 'live';
  }

  if (gamesA >= need || gamesB >= need) {
    status = 'finished';
    match.winnerId = gamesA > gamesB ? match.teamA : gamesB > gamesA ? match.teamB : undefined;
  } else if (board.status === 'finished') {
    status = 'finished';
    if (gamesA !== gamesB) {
      match.winnerId = gamesA > gamesB ? match.teamA : match.teamB;
    } else {
      match.winnerId = undefined;
      warnings.push('finished_without_winner');
    }
  } else {
    match.winnerId = undefined;
  }

  match.status = status;
  return { ok: true, warnings };
}
