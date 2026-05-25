import { countGamesWon } from './viewHelpers.js';

function teamId(team) {
  return String(team?._id ?? team ?? '');
}

function sortTeamsInGroup(teams) {
  return [...teams].sort((a, b) => {
    const ca = String(a.code || '').trim();
    const cb = String(b.code || '').trim();
    if (ca && cb && ca !== cb) return ca.localeCompare(cb, 'en', { numeric: true });
    if (ca && !cb) return -1;
    if (!ca && cb) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hant');
  });
}

function findPairMatch(teamA, teamB, matches, groupId) {
  const a = teamId(teamA);
  const b = teamId(teamB);
  if (!a || !b || a === b) return null;

  return (
    matches.find((m) => {
      if (groupId) {
        const gid = m.groupId ? String(m.groupId) : '';
        if (gid && gid !== String(groupId)) return false;
      }
      const ma = String(m.teamA?._id ?? m.teamA);
      const mb = String(m.teamB?._id ?? m.teamB);
      return (ma === a && mb === b) || (ma === b && mb === a);
    }) || null
  );
}

/** 以「列隊伍」視角顯示比分 */
function scoreLabelForMatch(match, rowTeamId) {
  if (!match) return '';
  const rowId = String(rowTeamId);
  const ma = String(match.teamA?._id ?? match.teamA);
  const rowIsA = ma === rowId;
  const completed = match.completedGames || [];
  const ca = match.currentPoints?.a ?? 0;
  const cb = match.currentPoints?.b ?? 0;

  if (completed.length) {
    const { gamesA, gamesB } = countGamesWon(completed);
    return rowIsA ? `${gamesA}-${gamesB}` : `${gamesB}-${gamesA}`;
  }
  if (match.status === 'live' || ca > 0 || cb > 0) {
    return rowIsA ? `[${ca}-${cb}]` : `[${cb}-${ca}]`;
  }
  return '';
}

/**
 * @param {{ groups: object[], teams: object[], matches: object[] }} input
 * @returns {Array<{ group: object, teams: object[], rows: object[][] }>}
 */
export function buildGroupRoundRobinMatrices({ groups, teams, matches }) {
  const allMatches = matches || [];
  const list = [];

  for (const group of groups || []) {
    const gid = String(group._id);
    const groupTeams = sortTeamsInGroup(
      (teams || []).filter(
        (t) => !t.isPlaceholder && t.groupId && String(t.groupId) === gid
      )
    );
    if (groupTeams.length < 2) {
      list.push({ group, teams: groupTeams, rows: [] });
      continue;
    }

    const rows = [];
    for (let i = 0; i < groupTeams.length; i++) {
      const rowTeam = groupTeams[i];
      const cells = [];
      for (let j = 0; j < groupTeams.length; j++) {
        if (i === j) {
          cells.push({ kind: 'self' });
          continue;
        }
        const colTeam = groupTeams[j];
        const match = findPairMatch(rowTeam, colTeam, allMatches, gid);
        if (!match) {
          cells.push({ kind: 'none' });
          continue;
        }
        const status = match.status || 'scheduled';
        cells.push({
          kind: 'match',
          matchId: String(match._id),
          status,
          score: scoreLabelForMatch(match, rowTeam._id),
          label:
            status === 'finished'
              ? '已打'
              : status === 'live'
                ? '進行中'
                : status === 'postponed'
                  ? '延期'
                  : status === 'cancelled'
                    ? '取消'
                    : '未打',
        });
      }
      rows.push({ team: rowTeam, cells });
    }

    list.push({ group, teams: groupTeams, rows });
  }

  return list;
}

/** 為前台比賽組別附加小組對戰矩陣 */
export function attachRoundRobinMatricesToCompetitions(competitions, { groups, teams, matches }) {
  if (!competitions?.length) return competitions;

  const groupsByTid = new Map();
  for (const g of groups || []) {
    const tid = String(g.tournamentId);
    if (!groupsByTid.has(tid)) groupsByTid.set(tid, []);
    groupsByTid.get(tid).push(g);
  }

  const teamsByTid = new Map();
  for (const t of teams || []) {
    if (t.isPlaceholder) continue;
    const tid = String(t.tournamentId);
    if (!teamsByTid.has(tid)) teamsByTid.set(tid, []);
    teamsByTid.get(tid).push(t);
  }

  for (const comp of competitions) {
    const tid = comp.groupTournamentId ? String(comp.groupTournamentId) : '';
    if (!tid || !comp.standings) {
      comp.roundRobinMatrices = [];
      continue;
    }
    const compMatches = comp.groupMatches || (matches || []).filter((m) => String(m.tournamentId) === tid);
    comp.roundRobinMatrices = buildGroupRoundRobinMatrices({
      groups: groupsByTid.get(tid) || [],
      teams: teamsByTid.get(tid) || [],
      matches: compMatches,
    });
  }

  return competitions;
}
