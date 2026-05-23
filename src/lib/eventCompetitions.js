import { buildKnockoutLadderColumns } from './knockoutLadder.js';
import { getPodiumFromKnockoutMatches } from './knockoutPodium.js';
import { formatDateDisplayZh, normalizeDateOnly } from './datetime.js';

function competitionDateLabel(groupTournament, knockoutTournament) {
  const g = normalizeDateOnly(groupTournament?.competitionDate);
  const k = normalizeDateOnly(knockoutTournament?.competitionDate);
  if (g && k && g !== k) return `${formatDateDisplayZh(g)} · 淘汰 ${formatDateDisplayZh(k)}`;
  const one = g || k;
  return one ? formatDateDisplayZh(one) : '';
}

/** 舊資料：依名稱推測淘汰賽對應的小組賽 */
export function guessKnockoutSourceGroupId(knockout, groupTournaments) {
  const kn = String(knockout.name || '').trim();
  if (!kn) return '';
  for (const g of groupTournaments) {
    const gn = String(g.name || '').trim();
    if (!gn) continue;
    if (String(knockout.sourceGroupTournamentId || '') === String(g._id)) return String(g._id);
    if (kn === gn) return String(g._id);
    if (kn === `${gn}淘汰` || kn === `${gn}（淘汰）`) return String(g._id);
    if (kn.startsWith(gn) && /淘汰|knockout|KO/i.test(kn.slice(gn.length))) return String(g._id);
    if (gn.startsWith(kn.replace(/（?淘汰）?$/i, '').trim())) return String(g._id);
  }
  return '';
}

function sortMatches(a, b) {
  const ta = a.scheduledTime || '';
  const tb = b.scheduledTime || '';
  if (ta !== tb) return ta.localeCompare(tb);
  const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return ca - cb;
}

/**
 * 組合前台「比賽組別」：小組賽 + 綁定的淘汰賽
 */
export function buildEventCompetitions({
  tournaments,
  groupStandingsList,
  matches,
  knockoutMatchesByTournamentId,
}) {
  const groups = (tournaments || []).filter((t) => t.phase === 'group');
  const knockouts = (tournaments || []).filter((t) => t.phase === 'knockout');

  const standingsByGroupId = new Map(
    (groupStandingsList || []).map((s) => [String(s.tournament._id), s])
  );

  const koByGroupId = new Map();
  const usedKoIds = new Set();

  for (const ko of knockouts) {
    const sid =
      (ko.sourceGroupTournamentId && String(ko.sourceGroupTournamentId)) ||
      guessKnockoutSourceGroupId(ko, groups);
    if (sid && !koByGroupId.has(sid)) {
      koByGroupId.set(sid, ko);
      usedKoIds.add(String(ko._id));
    }
  }

  const matchesByTid = new Map();
  for (const m of matches || []) {
    const tid = String(m.tournamentId);
    if (!matchesByTid.has(tid)) matchesByTid.set(tid, []);
    matchesByTid.get(tid).push(m);
  }

  const competitions = groups.map((g) => {
    const gid = String(g._id);
    const ko = koByGroupId.get(gid) || null;
    const koId = ko ? String(ko._id) : '';
    const groupMs = matchesByTid.get(gid) || [];
    const koMs = koId ? knockoutMatchesByTournamentId?.get(koId) || matchesByTid.get(koId) || [] : [];
    const allMs = [...groupMs, ...koMs].sort(sortMatches);

    const koPopulated = koMs;
    const competitionDate =
      normalizeDateOnly(g.competitionDate) || normalizeDateOnly(ko?.competitionDate) || '';
    return {
      key: gid,
      name: g.name,
      order: g.order ?? 0,
      competitionDate,
      competitionDateLabel: competitionDateLabel(g, ko),
      groupTournamentId: gid,
      knockoutTournamentId: koId,
      hasKnockout: !!ko,
      standings: standingsByGroupId.get(gid) || null,
      advancePerGroup: g.advancePerGroup ?? 2,
      knockoutLadderColumns: ko ? buildKnockoutLadderColumns(koPopulated) : [],
      podium: ko ? getPodiumFromKnockoutMatches(koPopulated) : null,
      groupMatches: groupMs,
      knockoutMatches: koMs,
      matches: allMs,
    };
  });

  const orphanKnockouts = knockouts
    .filter((ko) => !usedKoIds.has(String(ko._id)))
    .map((ko) => {
      const koId = String(ko._id);
      const koMs = knockoutMatchesByTournamentId?.get(koId) || matchesByTid.get(koId) || [];
      const label = formatDateDisplayZh(ko.competitionDate);
      const competitionDate = normalizeDateOnly(ko.competitionDate) || '';
      return {
        key: koId,
        name: ko.name,
        order: ko.order ?? 0,
        competitionDate,
        competitionDateLabel: label,
        knockoutTournamentId: koId,
        knockoutLadderColumns: buildKnockoutLadderColumns(koMs),
        podium: getPodiumFromKnockoutMatches(koMs),
        matches: [...koMs].sort(sortMatches),
      };
    });

  const podiumsWithResults = competitions
    .filter((c) => c.hasKnockout && c.podium)
    .map((c) => ({ name: c.name, podium: c.podium }))
    .concat(
      orphanKnockouts.filter((o) => o.podium).map((o) => ({ name: o.name, podium: o.podium }))
    );

  return { competitions, orphanKnockouts, podiumsWithResults };
}

/** 依比賽日期分組（供前台導覽） */
export function buildEventDateGroups(competitions, orphanKnockouts) {
  const map = new Map();
  const undated = {
    key: '__undated__',
    label: '日期未定',
    competitions: [],
    orphanKnockouts: [],
  };

  function addItem(item, isOrphan) {
    const dk = item.competitionDate || '';
    if (!dk) {
      if (isOrphan) undated.orphanKnockouts.push(item);
      else undated.competitions.push(item);
      return;
    }
    if (!map.has(dk)) {
      map.set(dk, {
        key: dk,
        label: formatDateDisplayZh(dk),
        competitions: [],
        orphanKnockouts: [],
      });
    }
    const bucket = map.get(dk);
    if (isOrphan) bucket.orphanKnockouts.push(item);
    else bucket.competitions.push(item);
  }

  for (const c of competitions || []) addItem(c, false);
  for (const o of orphanKnockouts || []) addItem(o, true);

  const sortByOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'zh-Hant');

  const groups = [...map.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((g) => {
      g.competitions.sort(sortByOrder);
      g.orphanKnockouts.sort(sortByOrder);
      return g;
    });

  if (undated.competitions.length || undated.orphanKnockouts.length) {
    undated.competitions.sort(sortByOrder);
    undated.orphanKnockouts.sort(sortByOrder);
    groups.push(undated);
  }

  return groups;
}

/** 預設日期分頁：今天；若無則選最接近今天的比賽日 */
export function pickDefaultEventDateKey(dateGroups, todayIso) {
  if (!dateGroups?.length) return '';
  const today = normalizeDateOnly(todayIso || new Date());
  const dated = dateGroups.filter((g) => g.key && g.key !== '__undated__');
  if (!dated.length) return dateGroups[0].key;

  if (today) {
    const exact = dated.find((g) => g.key === today);
    if (exact) return exact.key;

    const todayMs = new Date(`${today}T12:00:00`).getTime();
    let best = dated[0];
    let bestDiff = Infinity;
    for (const g of dated) {
      const ms = new Date(`${g.key}T12:00:00`).getTime();
      if (Number.isNaN(ms)) continue;
      const diff = Math.abs(ms - todayMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = g;
      }
    }
    return best.key;
  }

  return dated[0].key;
}

/** 在指定日期組內找賽事 key */
export function findCompInDateGroups(dateGroups, compKey) {
  if (!compKey) return null;
  for (const dg of dateGroups || []) {
    const hit =
      dg.competitions.find((c) => c.key === compKey) ||
      dg.orphanKnockouts.find((o) => o.key === compKey);
    if (hit) return { dateKey: dg.key, comp: hit };
  }
  return null;
}
