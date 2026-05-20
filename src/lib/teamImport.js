import * as XLSX from 'xlsx';
import mongoose from 'mongoose';
import { Group } from '../models/Group.js';
import { Team } from '../models/Team.js';

/** 表頭 → 內部欄位 key */
const HEADER_MAP = new Map([
  ['team_name', 'name'],
  ['name', 'name'],
  ['team', 'name'],
  ['隊伍', 'name'],
  ['隊伍名稱', 'name'],
  ['隊名', 'name'],
  ['group', 'group'],
  ['組別', 'group'],
  ['seed', 'seed'],
  ['種子', 'seed'],
]);

function normalizeHeaderKey(raw) {
  const s = String(raw ?? '')
    .replace(/\ufeff/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s/g, '');
  return HEADER_MAP.get(s) || HEADER_MAP.get(String(raw).replace(/\ufeff/g, '').trim()) || null;
}

/**
 * 第一列為表頭；自第二列起為隊伍資料。
 */
export function parseTeamWorkbookBuffer(buffer) {
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

  if (colIndex.name === undefined) {
    return {
      rows: [],
      parseErrors: [
        '第一列須包含隊伍名稱欄：請使用 name / team_name / 隊伍 / 隊伍名稱 / 隊名（擇一）。可下載後台提供的範本。',
      ],
    };
  }

  const rows = [];
  const parseErrors = [];

  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line || !line.some((c) => String(c).trim())) continue;

    const teamName = String(line[colIndex.name] ?? '').trim();
    if (!teamName) {
      parseErrors.push(`第 ${r + 1} 列：隊伍名稱為空，已略過`);
      continue;
    }

    const groupName =
      colIndex.group !== undefined ? String(line[colIndex.group] ?? '').trim() : '';

    let seed;
    if (colIndex.seed !== undefined) {
      const raw = line[colIndex.seed];
      if (raw !== '' && raw != null) {
        const n = parseInt(String(raw).trim(), 10);
        if (!Number.isNaN(n) && n >= 0) seed = n;
      }
    }

    rows.push({
      rowNum: r + 1,
      name: teamName,
      groupName,
      seed,
    });
  }

  if (!rows.length && !parseErrors.length) {
    parseErrors.push('沒有任何資料列（請從第二列開始填隊伍）');
  }

  return { rows, parseErrors };
}

export async function importTeamsFromRows(tournamentId, rows) {
  const tid = new mongoose.Types.ObjectId(tournamentId);
  const groups = await Group.find({ tournamentId: tid }).lean();
  const groupByName = new Map();
  for (const g of groups) {
    groupByName.set(g.name.trim(), g);
    groupByName.set(g.name.trim().toLowerCase(), g);
  }

  const existingTeams = await Team.find({ tournamentId: tid }).select('name').lean();
  const seenNames = new Set();
  for (const t of existingTeams) {
    seenNames.add(t.name.trim().toLowerCase());
  }

  const created = [];
  const errors = [];
  const addedThisBatch = new Set();

  for (const row of rows) {
    const n = row.name.trim();
    const key = n.toLowerCase();

    if (addedThisBatch.has(key)) {
      errors.push(`第 ${row.rowNum} 列：檔案內隊伍「${n}」重複，已略過`);
      continue;
    }
    if (seenNames.has(key)) {
      errors.push(`第 ${row.rowNum} 列：隊伍「${n}」已存在，已略過`);
      continue;
    }

    let groupId;
    if (row.groupName) {
      const g =
        groupByName.get(row.groupName.trim()) || groupByName.get(row.groupName.trim().toLowerCase());
      if (!g) {
        errors.push(`第 ${row.rowNum} 列：找不到組別「${row.groupName}」`);
        continue;
      }
      groupId = g._id;
    }

    await Team.create({
      tournamentId: tid,
      groupId,
      name: n,
      seed: row.seed !== undefined ? row.seed : undefined,
    });
    created.push(n);
    seenNames.add(key);
    addedThisBatch.add(key);
  }

  return { createdCount: created.length, errors };
}

export function buildTeamImportTemplateSheet() {
  const data = [
    ['team_name', 'group', 'seed'],
    ['紅隊', 'A組', 1],
    ['藍隊', 'A組', 2],
    ['黃隊', 'B組', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'teams');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
