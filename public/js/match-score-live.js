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

  /** 小組矩陣：以列隊伍視角顯示比分 */
  function scoreLabelForRow(match, rowTeamId) {
    if (!match) return '';
    var rowId = String(rowTeamId);
    var ma = String((match.teamA && match.teamA._id) || match.teamA || '');
    var rowIsA = ma === rowId;
    var completed = match.completedGames || [];
    var ca = (match.currentPoints && match.currentPoints.a) || 0;
    var cb = (match.currentPoints && match.currentPoints.b) || 0;

    if (completed.length) {
      var won = countGamesWon(completed);
      return rowIsA ? won.gamesA + '-' + won.gamesB : won.gamesB + '-' + won.gamesA;
    }
    if (match.status === 'live' || ca > 0 || cb > 0) {
      return rowIsA ? '[' + ca + '-' + cb + ']' : '[' + cb + '-' + ca + ']';
    }
    return '';
  }

  function cellLabel(status) {
    if (status === 'finished') return '已打';
    if (status === 'live') return '進行';
    if (status === 'postponed') return '延期';
    if (status === 'cancelled') return '取消';
    return '未打';
  }

  var RR_STATUS_CLASS = {
    finished: 'bg-emerald-950/35 text-emerald-200',
    live: 'bg-amber-950/40 text-amber-200',
    postponed: 'bg-rose-950/25 text-rose-300/90',
    cancelled: 'bg-rose-950/25 text-rose-300/90',
    scheduled: 'bg-slate-900/80 text-slate-400',
  };

  function applyRrCellClasses(td, status) {
    var base = 'rr-matrix-cell px-1 py-2 ';
    var extra = RR_STATUS_CLASS[status] || RR_STATUS_CLASS.scheduled;
    td.className = base + extra;
  }

  function renderRrCellContent(td, match, rowTeamId, eventSlug) {
    var status = match.status || 'scheduled';
    var score = scoreLabelForRow(match, rowTeamId);
    var label = cellLabel(status);
    var title = label + (score ? ' · ' + score : '');

    var canLink =
      eventSlug && (status === 'live' || status === 'finished');
    var href = canLink ? '/e/' + eventSlug + '/screen/' + String(match._id) : '';

    var inner = td.querySelector('.rr-matrix-inner');
    if (!inner) {
      inner = document.createElement(canLink ? 'a' : 'span');
      inner.className =
        'rr-matrix-inner block min-h-[2.25rem] leading-snug' +
        (canLink ? ' hover:underline' : '');
      td.textContent = '';
      td.appendChild(inner);
    }

    if (inner.tagName === 'A') {
      if (canLink) {
        inner.href = href;
        inner.target = '_blank';
        inner.rel = 'noopener';
      } else {
        var span = document.createElement('span');
        span.className = inner.className;
        span.title = title;
        td.replaceChild(span, inner);
        inner = span;
      }
    } else if (canLink) {
      var a = document.createElement('a');
      a.className =
        'rr-matrix-inner block min-h-[2.25rem] leading-snug hover:underline';
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      td.replaceChild(a, inner);
      inner = a;
    }

    inner.title = title;
    inner.textContent = '';

    if (status === 'finished' && score) {
      var s = document.createElement('span');
      s.className = 'rr-matrix-score font-mono font-semibold';
      s.textContent = score;
      inner.appendChild(s);
    } else if (status === 'live') {
      var l1 = document.createElement('span');
      l1.className = 'rr-matrix-label block text-[10px]';
      l1.textContent = '進行';
      inner.appendChild(l1);
      if (score) {
        var l2 = document.createElement('span');
        l2.className = 'rr-matrix-score font-mono text-[10px]';
        l2.textContent = score;
        inner.appendChild(l2);
      }
    } else {
      var lb = document.createElement('span');
      lb.className = 'rr-matrix-label text-[10px]';
      lb.textContent = label;
      inner.appendChild(lb);
    }
  }

  function patchRoundRobinMatrix(m, opts) {
    if (!m || !m._id) return false;
    var eventSlug = (opts && opts.eventSlug) || '';
    var cells = document.querySelectorAll(
      '.rr-matrix-cell[data-match-id="' + String(m._id) + '"]'
    );
    if (!cells.length) return false;

    cells.forEach(function (td) {
      var rowTeamId = td.getAttribute('data-row-team-id');
      if (!rowTeamId) return;
      var status = m.status || 'scheduled';
      applyRrCellClasses(td, status);
      renderRrCellContent(td, m, rowTeamId, eventSlug);
    });
    return true;
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
    var nodes = document.querySelectorAll(
      '[data-match-id="' + id + '"], [data-id="' + id + '"]'
    );
    if (!nodes.length) return false;
    nodes.forEach(function (root) {
      if (root.classList.contains('rr-matrix-cell')) return;
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

  function patchAll(m, opts) {
    var a = patchMatchInDom(m);
    var b = patchRoundRobinMatrix(m, opts);
    return a || b;
  }

  global.MatchScoreLive = {
    scoreDisplayParts: scoreDisplayParts,
    patchMatchInDom: patchMatchInDom,
    patchRoundRobinMatrix: patchRoundRobinMatrix,
    patchAll: patchAll,
    needsFullReload: needsFullReload,
  };
})(typeof window !== 'undefined' ? window : global);
