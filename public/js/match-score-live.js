/**
 * 前台即時比分（與 src/lib/viewHelpers.js scoreDisplayParts 邏輯一致）
 */
(function (global) {
  function countGamesWon(completedGames) {
    var gamesA = 0;
    var gamesB = 0;
    for (var i = 0; i < (completedGames || []).length; i++) {
      var g = completedGames[i];
      if (g.a > g.b) gamesA += 1;
      else if (g.b > g.a) gamesB += 1;
    }
    return { gamesA: gamesA, gamesB: gamesB };
  }

  function isSummaryCompletedGame(g) {
    return (g.a === 15 && g.b === 0) || (g.a === 0 && g.b === 15);
  }

  function completedGamesDetail(completedGames) {
    if (!completedGames || !completedGames.length) return '';
    var real = completedGames.filter(function (g) {
      return !isSummaryCompletedGame(g);
    });
    if (!real.length) return '';
    return real
      .map(function (g) {
        return g.a + '-' + g.b;
      })
      .join(' · ');
  }

  function scoreDisplayParts(m) {
    if (!m) return { main: '—', detail: '' };
    var ca = (m.currentPoints && m.currentPoints.a) || 0;
    var cb = (m.currentPoints && m.currentPoints.b) || 0;
    var completed = m.completedGames || [];
    var won = countGamesWon(completed);
    var detail = completedGamesDetail(completed);
    var main = '';
    if (completed.length) {
      main = won.gamesA + '-' + won.gamesB;
    }
    var live =
      m.status === 'live' || (m.status === 'scheduled' && (ca > 0 || cb > 0))
        ? '[' + ca + '-' + cb + ']'
        : '';
    if (live) {
      detail = detail ? detail + ' · ' + live : live;
    }
    if (!main) {
      if (ca > 0 || cb > 0) main = '[' + ca + '-' + cb + ']';
      else main = '—';
    }
    return { main: main, detail: detail };
  }

  function patchScoreCell(cell, m) {
    if (!cell) return;
    var sp = scoreDisplayParts(m);
    var main = cell.querySelector('.match-score-main');
    var detail = cell.querySelector('.match-score-detail');
    if (main) main.textContent = sp.main;
    if (detail) {
      if (sp.detail) {
        detail.textContent = sp.detail;
        detail.classList.remove('hidden');
      } else {
        detail.textContent = '';
        detail.classList.add('hidden');
      }
    }
  }

  /** 更新頁面上該場次的比分顯示；有對應節點則回傳 true */
  function patchMatchInDom(m) {
    if (!m || !m._id) return false;
    var id = String(m._id);
    var nodes = document.querySelectorAll('[data-match-id="' + id + '"], [data-id="' + id + '"]');
    if (!nodes.length) return false;
    nodes.forEach(function (root) {
      root.querySelectorAll('.score-cell, .match-score-display').forEach(function (cell) {
        patchScoreCell(cell.closest('.match-score-display') || cell, m);
      });
    });
    return true;
  }

  function needsFullReload(matches) {
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      if (!m) continue;
      if (m.status === 'finished') return true;
    }
    return false;
  }

  global.MatchScoreLive = {
    scoreDisplayParts: scoreDisplayParts,
    patchMatchInDom: patchMatchInDom,
    needsFullReload: needsFullReload,
  };
})(typeof window !== 'undefined' ? window : global);
