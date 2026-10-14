import { gameLineupNote, LEAGUE_GAME_LABELS } from './leagueRules.js';
import { resolveGamePlayers, resolveCurrentPlayers, playersFromConfirmedLineup } from './leagueLineup.js';
import { normalizeDateOnly } from './datetime.js';

/** 依已完成局計算雙方贏局數 */
export function countGamesWon(completedGames) {
  let gamesA = 0;
  let gamesB = 0;
  for (const g of completedGames || []) {
    if (g.a > g.b) gamesA += 1;
    else if (g.b > g.a) gamesB += 1;
  }
  return { gamesA, gamesB };
}

/** 大會計分牌寫回時用的贏局摘要（非真實每局比分） */
export function isSummaryCompletedGame(g) {
  return (g.a === 15 && g.b === 0) || (g.a === 0 && g.b === 15);
}

/** 每局真實比分細項（略過計分牌寫回的 15-0 佔位） */
export function completedGamesDetail(completedGames) {
  if (!completedGames?.length) return '';
  const real = completedGames.filter((g) => !isSummaryCompletedGame(g));
  if (!real.length) return '';
  return real.map((g) => `${g.a}-${g.b}`).join(' · ');
}

/** 比分顯示：main = 大比分贏局數（2-1），聯賽則為五回合總分 */
export function scoreDisplayParts(m) {
  if (!m) return { main: '—', detail: '' };
  const ca = m.currentPoints?.a ?? 0;
  const cb = m.currentPoints?.b ?? 0;
  const completed = m.completedGames || [];

  if (m.matchFormat === 'leagueFive') {
    let ptsA = 0;
    let ptsB = 0;
    const bits = [];
    const live = m.status === 'live' || (m.status === 'scheduled' && (ca > 0 || cb > 0));
    const boardPreview = LEAGUE_GAME_LABELS.some((_, i) => {
      const p = playersFromConfirmedLineup(m, i);
      return p.playersA.length || p.playersB.length;
    });

    for (let i = 0; i < LEAGUE_GAME_LABELS.length; i++) {
      const g = completed[i];
      const lab = g?.label || LEAGUE_GAME_LABELS[i] || `第${i + 1}場`;
      const who = gameLineupNote(resolveGamePlayers(m, i, g));
      const note = g?.remark ? ` ※${g.remark}` : '';
      if (g) {
        ptsA += Number(g.a || 0);
        ptsB += Number(g.b || 0);
        bits.push(`${lab} ${g.a}-${g.b}${who ? ' ' + who : ''}${note}`);
      } else if (live && i === completed.length) {
        const liveWho = gameLineupNote(resolveCurrentPlayers(m));
        bits.push(`${lab} [${ca}-${cb}]${liveWho ? ' ' + liveWho : ''}`);
        ptsA += ca;
        ptsB += cb;
      } else if (who) {
        bits.push(`${lab} ${who}${note}`);
      }
    }

    if (!completed.length && !live && !boardPreview) return { main: '—', detail: '' };
    if (!completed.length && !live && boardPreview) return { main: '—', detail: bits.join(' · ') };
    return { main: `${ptsA}-${ptsB}`, detail: bits.join(' · ') };
  }

  const { gamesA, gamesB } = countGamesWon(completed);
  let detail = completedGamesDetail(completed);
  let main = '';

  if (completed.length) {
    main = `${gamesA}-${gamesB}`;
  }

  const live =
    m.status === 'live' || (m.status === 'scheduled' && (ca > 0 || cb > 0))
      ? `[${ca}-${cb}]`
      : '';

  if (live) {
    detail = detail ? `${detail} · ${live}` : live;
  }

  if (!main) {
    if (ca > 0 || cb > 0) main = `[${ca}-${cb}]`;
    else main = '—';
  }

  return { main, detail };
}

/** EJS helper：單行摘要（列表欄位用） */
export function scoreSummary(m) {
  const { main, detail } = scoreDisplayParts(m);
  if (detail) return `${main} · ${detail}`;
  return main;
}

/** 「大比分（贏局數）」區塊：大比分 + 括號細分 */
export function gamesLine(m) {
  const { main, detail } = scoreDisplayParts(m);
  if (main === '—' && !detail) return '—';
  if (!detail) return main;
  return `${main}（${detail}）`;
}

export function formatLabel(matchFormat) {
  const map = {
    bestOf5: '五局三勝',
    bestOf3: '三局兩勝',
    leagueFive: '聯賽五回合（21分）',
  };
  return map[matchFormat] || matchFormat;
}

export function matchStatusLabel(status) {
  const map = {
    scheduled: '未開',
    live: '進行中',
    finished: '完賽',
    postponed: '延期',
    cancelled: '取消',
  };
  return map[status] || status || '—';
}

/** 下拉選單等純文字：A1 楊霖鑫 */
export function formatTeamWithCode(team) {
  if (!team) return '—';
  const name = team.name || '—';
  const code = team.code ? String(team.code).trim() : '';
  if (code) return `${code} ${name}`;
  return name;
}

/** 隊伍顯示用主／副標（編號 + 名稱） */
export function teamDisplayParts(team) {
  if (!team) return { primary: '—', secondary: '' };
  const name = team.name ? String(team.name).trim() : '';
  const code = team.code ? String(team.code).trim() : '';
  if (code) return { primary: code, secondary: name };
  return { primary: name || '—', secondary: '' };
}

/** 公開賽程表：附加賽事名稱、小組／輪次標籤 */
export function enrichMatchesForSchedule(matches, tournaments, groups) {
  const tName = Object.fromEntries((tournaments || []).map((t) => [String(t._id), t.name]));
  const tPhase = Object.fromEntries((tournaments || []).map((t) => [String(t._id), t.phase]));
  const tDate = Object.fromEntries(
    (tournaments || []).map((t) => [String(t._id), String(t.competitionDate || '').trim()])
  );
  const gName = Object.fromEntries((groups || []).map((g) => [String(g._id), g.name]));
  return (matches || []).map((m) => {
    let groupName = m.groupId ? gName[String(m.groupId)] || '' : '';
    if (!groupName) {
      const ta = m.teamA;
      const tb = m.teamB;
      if (ta?.groupId && tb?.groupId && String(ta.groupId) === String(tb.groupId)) {
        groupName = gName[String(ta.groupId)] || '';
      }
    }
    const round = String(m.round || '').trim();
    return {
      ...m,
      tournamentName: tName[String(m.tournamentId)] || '',
      tournamentPhase: tPhase[String(m.tournamentId)] || '',
      competitionDate: normalizeDateOnly(m.scheduledDate) || tDate[String(m.tournamentId)] || '',
      groupName,
      scheduleGroupLabel: groupName || round || '',
    };
  });
}
