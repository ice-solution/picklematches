import { gamesNeededToWinMatch } from './scoring.js';
import { isSummaryCompletedGame } from './viewHelpers.js';

const BOARD_TO_MATCH_STATUS = {
  idle: 'scheduled',
  live: 'live',
  finished: 'finished',
};

/**
 * 將大會計分牌資料寫回賽程場次（需已連結 linkedMatchId）。
 * 優先使用計分牌 recordedGames（每局真實比分）；否則以贏局數合成摘要。
 * @returns {{ ok: true, warnings: string[] }}
 */
export function applyScoreboardToMatch(match, board) {
  const warnings = [];
  const scoreA = Math.max(0, Number(board.scoreA) || 0);
  const scoreB = Math.max(0, Number(board.scoreB) || 0);
  const gamesA = Math.max(0, Number(board.gamesA) || 0);
  const gamesB = Math.max(0, Number(board.gamesB) || 0);

  match.currentPoints = { a: scoreA, b: scoreB };

  const hasLivePoints = scoreA > 0 || scoreB > 0;
  const recorded = Array.isArray(board.recordedGames)
    ? board.recordedGames.map((g) => ({
        a: Math.max(0, Number(g.a) || 0),
        b: Math.max(0, Number(g.b) || 0),
      }))
    : [];

  let completed = [];
  if (recorded.length > 0) {
    completed = recorded;
  } else {
    for (let i = 0; i < gamesA; i++) {
      const isLast = i === gamesA - 1;
      if (isLast && gamesB === 0 && hasLivePoints) {
        completed.push({ a: scoreA, b: scoreB });
      } else {
        completed.push({ a: 15, b: 0 });
      }
    }
    for (let i = 0; i < gamesB; i++) {
      const isLast = i === gamesB - 1;
      if (isLast && gamesA === 0 && hasLivePoints) {
        completed.push({ a: scoreA, b: scoreB });
      } else {
        completed.push({ a: 0, b: 15 });
      }
    }
    if (completed.some(isSummaryCompletedGame)) {
      warnings.push('completed_games_summary');
    }
  }

  const totalWon = gamesA + gamesB;
  if (
    hasLivePoints &&
    totalWon > completed.length &&
    (board.status === 'finished' || gamesA >= gamesNeededToWinMatch(match.matchFormat) || gamesB >= gamesNeededToWinMatch(match.matchFormat))
  ) {
    completed.push({ a: scoreA, b: scoreB });
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
