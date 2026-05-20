import * as XLSX from 'xlsx';
import mongoose from 'mongoose';
import { Tournament } from '../models/Tournament.js';

/** 表頭 → 內部欄位 key */
const HEADER_MAP = new Map([
  ['name', 'name'],
  ['tournament', 'name'],
  ['賽事', 'name'],
  ['賽事名稱', 'name'],
  ['項目', 'name'],
  ['phase', 'phase'],
  ['類型', 'phase'],
  ['賽制', 'phase'],
  ['advance_per_group', 'advancePerGroup'],
  ['advancepergroup', 'advancePerGroup'],
  ['晉級', 'advancePerGroup'],
  ['各組前n名', 'advancePerGroup'],
  ['order', 'order'],
  ['排序', 'order'],
]);

function normalizeHeaderKey(raw) {
  const s = String(raw ?? '')
    .replace(/\ufeff/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s/g, '');
  return HEADER_MAP.get(s) || HEADER_MAP.get(String(raw).replace(/\ufeff/g, '').trim()) || null;
}

function parsePhase(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return 'group';
  const s = t.toLowerCase().replace(/\s/g, '');
  if (['group', 'groups', 'g', '小組', '小組賽', '分組', '循環'].includes(s) || /小組/.test(t)) return 'group';
  if (['knockout', 'ko', 'k', '淘汰', '淘汰賽'].includes(s) || /淘汰/.test(t)) return 'knockout';
  return null;
}

function toIntOrEmpty(raw) {
  if (raw === '' || raw == null) return undefined;
  const n = parseInt(String(raw).trim(), 10);
  if (Number.isNaN(n)) return undefined;
  return n;
}

/**
 * 第一列為表頭；自第二列起為賽事資料。
 */
export function parseTournamentWorkbookBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], parseErrors: ['檔案沒有工作表'] };
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!matrix.length) return { rows: [], parseErrors: ['工作表為空'] };

  const headerRow = matrix[0].map((c) => normalizeHeaderKey(c));
  const colIndex = {};
  headerRow.forEach((key, i) => {
    if (key && colIndex[key] === undefined) colIndex[key] = i;
  });

  if (colIndex.name === undefined) {
    return {
      rows: [],
      parseErrors: ['第一列須包含賽事名稱欄：name / 賽事名稱 / 項目（擇一）。可下載後台範本。'],
    };
  }

  const rows = [];
  const parseErrors = [];

  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    if (!line || !line.some((c) => String(c).trim())) continue;

    const name = String(line[colIndex.name] ?? '').trim();
    if (!name) {
      parseErrors.push(`第 ${r + 1} 列：賽事名稱為空，已略過`);
      continue;
    }

    const phaseRaw = colIndex.phase !== undefined ? line[colIndex.phase] : '';
    const phase = parsePhase(phaseRaw);
    if (phase == null) {
      parseErrors.push(`第 ${r + 1} 列：無法辨識類型「${phaseRaw}」，請用 group/knockout 或 小組賽/淘汰賽`);
      continue;
    }

    const advRaw = colIndex.advancePerGroup !== undefined ? line[colIndex.advancePerGroup] : '';
    const adv = toIntOrEmpty(advRaw);
    const advancePerGroup = adv != null && adv >= 1 ? adv : 2;

    const orderRaw = colIndex.order !== undefined ? line[colIndex.order] : '';
    const order = toIntOrEmpty(orderRaw);

    rows.push({ rowNum: r + 1, name, phase, advancePerGroup, order });
  }

  if (!rows.length && !parseErrors.length) {
    parseErrors.push('沒有任何資料列（請從第二列開始填賽事）');
  }

  return { rows, parseErrors };
}

export async function importTournamentsFromRows(eventId, rows) {
  const eid = new mongoose.Types.ObjectId(eventId);
  const existing = await Tournament.find({ eventId: eid }).select('name order').lean();
  const existingByName = new Set(existing.map((t) => String(t.name || '').trim().toLowerCase()).filter(Boolean));
  const maxOrder = existing.reduce((m, t) => Math.max(m, t.order ?? -1), -1);

  const created = [];
  const errors = [];
  let nextAutoOrder = maxOrder + 1;
  const usedOrder = new Set(existing.map((t) => Number(t.order ?? -1)));

  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    if (existingByName.has(key)) {
      errors.push(`第 ${row.rowNum} 列：賽事「${row.name}」已存在，已略過`);
      continue;
    }

    let order = row.order;
    if (order == null || usedOrder.has(order)) {
      while (usedOrder.has(nextAutoOrder)) nextAutoOrder++;
      order = nextAutoOrder;
      nextAutoOrder++;
    }
    usedOrder.add(order);

    await Tournament.create({
      eventId: eid,
      name: row.name,
      phase: row.phase,
      advancePerGroup: row.advancePerGroup,
      order,
    });
    created.push(row.name);
    existingByName.add(key);
  }

  return { createdCount: created.length, errors };
}

export function buildTournamentImportTemplateSheet() {
  const data = [
    ['name', 'phase', 'advance_per_group', 'order'],
    ['30+ 3.0- 男雙', 'group', 2, 0],
    ['30+ 3.0- 女雙', 'group', 2, 1],
    ['公開 混雙公開', 'knockout', 2, 10],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'tournaments');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

