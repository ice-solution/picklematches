import * as XLSX from 'xlsx';
import mongoose from 'mongoose';
import { Group } from '../models/Group.js';
import { Team } from '../models/Team.js';
import { Match, MATCH_FORMAT } from '../models/Match.js';
import { normalizeTimeToHHmm } from './matchTime.js';

/** 表頭：可擇一使用（不分大小寫、可含全形空格） */
const HEADER_MAP = new Map([
  ['team_a', 'team_a'],
  ['teama', 'team_a'],
  ['隊伍a', 'team_a'],
  ['隊伍_a', 'team_a'],
  ['a隊', 'team_a'],
  ['team_b', 'team_b'],
  ['teamb', 'team_b'],
  ['隊伍b', 'team_b'],
  ['隊伍_b', 'team_b'],
  ['b隊', 'team_b'],
  ['match_format', 'match_format'],
  ['matchformat', 'match_format'],
  ['賽制', 'match_format'],
  ['format', 'match_format'],
  ['round', 'round'],
  ['輪次', 'round'],
  ['標籤', 'round'],
  ['court', 'court'],
  ['場地', 'court'],
  ['scheduled_at', 'stime'],
  ['scheduled_time', 'stime'],
  ['scheduledat', 'stime'],
  ['時間', 'stime'],
  ['開賽時間', 'stime'],
  ['datetime', 'stime'],
  ['group', 'group'],
  ['組別', 'group'],
]);

function normalizeHeaderKey(raw) {
  const s = String(raw ?? '')
    .replace(/\ufeff/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s/g, '');
  return HEADER_MAP.get(s) || HEADER_MAP.get(String(raw).replace(/\ufeff/g, '').trim()) || null;
}

function parseMatchFormat(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return MATCH_FORMAT.BEST_OF_3;
  if (t === '三局兩勝') return MATCH_FORMAT.BEST_OF_3;
  if (t === '五局三勝') return MATCH_FORMAT.BEST_OF_5;
  if (t === '一局過' || t === '一局') return MATCH_FORMAT.SINGLE_GAME;
  const s = t.toLowerCase().replace(/\s/g, '');
  if (['bestof5', 'best_of_5', 'bo5'].includes(s)) return MATCH_FORMAT.BEST_OF_5;
  if (['bestof3', 'best_of_3', 'bo3'].includes(s)) return MATCH_FORMAT.BEST_OF_3;
  if (['singlegame', 'single'].includes(s)) return MATCH_FORMAT.SINGLE_GAME;
  if (Object.values(MATCH_FORMAT).includes(t)) return t;
  return null;
}

/**
 * 將第一列當作表頭，回傳正規化後的資料列
 */
export function parseMatchWorkbookBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const name = wb.SheetNames[0];
  if (!name) {
    return { rows: [], parseErrors: ['檔案沒有工作表'] };
  }
  const sheet = wb.Sheets[name];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!matrix.length) {
    return { rows: [], parseErrors: ['工作表為空'] };
  }

  const headerRow = matrix[0].map((c) => normalizeHeaderKey(c));
  const colIndex = {};
  headerRow.forEach((key, i) => {
    if (key && colIndex[key] === undefined) colIndex[key] = i;
  });

  if (colIndex.team_a === undefined || colIndex.team_b === undefined) {
    return {
      rows: [],
      parseErrors: [
        '第一列必須包含「隊伍」欄位：請使用 team_a 與 team_b（或 隊伍A / 隊伍B）。可下載後台提供的範本。',
      ],
    };
  }

  const rows = [];
  const parseErrors = [];

  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line || !line.some((c) => String(c).trim())) continue;

    const teamA = String(line[colIndex.team_a] ?? '').trim();
    const teamB = String(line[colIndex.team_b] ?? '').trim();
    if (!teamA || !teamB) {
      parseErrors.push(`第 ${r + 1} 列：隊伍 A 或 B 為空，已略過`);
      continue;
    }

    const mfRaw = colIndex.match_format !== undefined ? line[colIndex.match_format] : '';
    const mf = parseMatchFormat(mfRaw);
    if (mf == null) {
      parseErrors.push(`第 ${r + 1} 列：無法辨識賽制「${mfRaw}」，請用 bestOf3／bestOf5／singleGame 或 三局兩勝／五局三勝／一局過`);
      continue;
    }

    const round = colIndex.round !== undefined ? String(line[colIndex.round] ?? '').trim() : '';
    const court = colIndex.court !== undefined ? String(line[colIndex.court] ?? '').trim() : '';
    const groupName = colIndex.group !== undefined ? String(line[colIndex.group] ?? '').trim() : '';
    let scheduledTime = '';
    if (colIndex.stime !== undefined) {
      scheduledTime = normalizeTimeToHHmm(line[colIndex.stime]);
    }

    rows.push({
      rowNum: r + 1,
      team_a: teamA,
      team_b: teamB,
      match_format: mf,
      round,
      court,
      groupName,
      scheduledTime,
    });
  }

  if (!rows.length && !parseErrors.length) {
    parseErrors.push('沒有任何資料列（請從第二列開始填對戰）');
  }

  return { rows, parseErrors };
}

export async function importMatchesFromRows(tournamentId, rows) {
  const tid = new mongoose.Types.ObjectId(tournamentId);
  const teams = await Team.find({ tournamentId: tid }).lean();
  const byName = new Map();
  for (const t of teams) {
    byName.set(t.name.trim(), t);
    byName.set(t.name.trim().toLowerCase(), t);
  }

  async function ensurePlaceholderTeam(name) {
    const key = String(name || '').trim();
    const k2 = key.toLowerCase();
    const existing = byName.get(key) || byName.get(k2);
    if (existing) return existing;
    const doc = await Team.create({ tournamentId: tid, name: key, isPlaceholder: true });
    byName.set(key, doc);
    byName.set(k2, doc);
    return doc;
  }

  function looksLikeSlotName(s) {
    // A1 / B2 / C10 ...
    return /^[A-Z][0-9]{1,2}$/.test(String(s || '').trim());
  }

  const groups = await Group.find({ tournamentId: tid }).lean();
  const groupByName = new Map();
  for (const g of groups) {
    groupByName.set(g.name.trim(), g);
    groupByName.set(g.name.trim().toLowerCase(), g);
  }

  const created = [];
  const errors = [];

  for (const row of rows) {
    let ta = byName.get(row.team_a) || byName.get(row.team_a.toLowerCase());
    let tb = byName.get(row.team_b) || byName.get(row.team_b.toLowerCase());
    if (!ta || !tb) {
      // 允許淘汰賽預排 slot：A1/B2... 或 BYE
      const miss = !ta ? row.team_a : row.team_b;
      if (looksLikeSlotName(miss) || String(miss).trim().toUpperCase() === 'BYE') {
        if (!ta) ta = await ensurePlaceholderTeam(String(row.team_a).trim().toUpperCase());
        if (!tb) tb = await ensurePlaceholderTeam(String(row.team_b).trim().toUpperCase());
      } else {
        errors.push(`第 ${row.rowNum} 列：找不到隊伍「${miss}」（請先在後台建立隊伍，名稱需一致；淘汰賽預排可用 A1/B2… 或 BYE）`);
        continue;
      }
    }
    if (String(ta._id) === String(tb._id)) {
      errors.push(`第 ${row.rowNum} 列：兩隊不可相同`);
      continue;
    }

    let groupId;
    if (row.groupName) {
      const g = groupByName.get(row.groupName) || groupByName.get(row.groupName.toLowerCase());
      if (!g) {
        errors.push(`第 ${row.rowNum} 列：找不到組別「${row.groupName}」`);
        continue;
      }
      groupId = g._id;
    }

    const m = await Match.create({
      tournamentId: tid,
      groupId,
      round: row.round,
      matchFormat: row.match_format,
      teamA: ta._id,
      teamB: tb._id,
      court: row.court,
      scheduledTime: row.scheduledTime || '',
      status: 'scheduled',
      completedGames: [],
      currentGameIndex: 0,
      currentPoints: { a: 0, b: 0 },
    });
    created.push(m._id);
  }

  return { createdCount: created.length, errors };
}

export function buildMatchImportTemplateSheet() {
  const data = [
    ['team_a', 'team_b', 'match_format', 'round', 'court', 'scheduled_time', 'group'],
    ['紅隊', '藍隊', 'bestOf3', 'A組', '1號場', '14:00', 'A組'],
    ['紅隊', '黃隊', '三局兩勝', 'A組', '2號場', '09:30', 'A組'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'matches');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
