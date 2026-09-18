/**
 * 雙敗「樹狀圖」座標（由底向上接線）。
 * 做法參考 ren1244 雙敗樹：勝部在左、敗部在右、頂部總決賽相接。
 * 位置由實際場次推算，隊數變動會自動重排，唔係固定圖片。
 */

const SLOT = 92;
const ROW = 68;
const PAD = 20;
const GAP = 56;

function teamShort(team) {
  if (!team) return '待定';
  if (team.isPlaceholder) {
    const n = String(team.name || '');
    if (/^BYE$/i.test(n)) return 'BYE';
    return '待定';
  }
  const code = String(team.code || '').trim();
  const name = String(team.name || '').trim();
  const label = code || name || '—';
  return label.length > 8 ? `${label.slice(0, 7)}…` : label;
}

function scoreText(m) {
  const games = Array.isArray(m?.completedGames) ? m.completedGames : [];
  if (!games.length) return '';
  return games.map((g) => `${g.a ?? 0}-${g.b ?? 0}`).join(' ');
}

function nodeFrom(m, x1, x2, y, y1, y2) {
  return {
    id: m._id ? String(m._id) : '',
    x1,
    x2,
    y,
    y1,
    y2,
    cx: (x1 + x2) / 2,
    a: teamShort(m.teamA),
    b: teamShort(m.teamB),
    score: scoreText(m),
    finished: m.status === 'finished',
  };
}

function layoutSide(columns) {
  const rounds = (columns || []).map((c) => c.matches || []).filter((ms) => ms.length);
  if (!rounds.length) return null;

  const placed = [];
  const nodes = [];
  const leaves = [];
  const width = rounds[0].length * 2 * SLOT + PAD * 2;

  rounds.forEach((matches, r) => {
    const y = (rounds.length - r) * ROW;
    const rowPlaced = [];

    matches.forEach((m, i) => {
      let x1;
      let x2;
      let y1;
      let y2;
      if (r === 0) {
        x1 = PAD + i * 2 * SLOT + SLOT * 0.45;
        x2 = PAD + i * 2 * SLOT + SLOT * 1.55;
        y1 = y + 18;
        y2 = y + 18;
        leaves.push({ x: x1, y: y + 34, name: teamShort(m.teamA) });
        leaves.push({ x: x2, y: y + 34, name: teamShort(m.teamB) });
      } else {
        const prev = placed[r - 1];
        if (prev.length === matches.length * 2 && prev[i * 2] && prev[i * 2 + 1]) {
          x1 = prev[i * 2].cx;
          x2 = prev[i * 2 + 1].cx;
          y1 = prev[i * 2].y;
          y2 = prev[i * 2 + 1].y;
        } else if (prev.length === matches.length && prev[i]) {
          x1 = prev[i].cx;
          x2 = prev[i].cx + SLOT * 0.7;
          y1 = prev[i].y;
          y2 = y + ROW * 0.45;
        } else {
          const span0 = prev[0]?.cx ?? PAD + SLOT;
          const span1 = prev[prev.length - 1]?.cx ?? width - PAD;
          const cx =
            matches.length === 1 ? (span0 + span1) / 2 : span0 + ((span1 - span0) * i) / (matches.length - 1);
          x1 = cx - SLOT * 0.55;
          x2 = cx + SLOT * 0.55;
          const src = prev[Math.min(i, prev.length - 1)];
          y1 = src?.y ?? y + ROW;
          y2 = y1;
        }
      }
      const node = nodeFrom(m, x1, x2, y, y1, y2);
      rowPlaced.push(node);
      nodes.push(node);
    });
    placed.push(rowPlaced);
  });

  const top = placed[placed.length - 1]?.[0] || null;
  const leafY = (placed[0]?.[0]?.y || ROW) + 40;
  return { nodes, leaves, width, height: leafY, top };
}

function shiftSide(side, dx) {
  if (!side) return null;
  const move = (p) => ({ ...p, x: (p.x || 0) + dx, x1: (p.x1 || 0) + dx, x2: (p.x2 || 0) + dx, cx: (p.cx || 0) + dx });
  return {
    ...side,
    nodes: side.nodes.map(move),
    leaves: side.leaves.map((l) => ({ ...l, x: l.x + dx })),
    top: side.top ? move(side.top) : null,
    width: side.width,
    height: side.height,
  };
}

function fitPanel(side) {
  if (!side?.nodes?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const n of side.nodes) {
    take(n.x1, n.y1);
    take(n.x2, n.y2);
    take(n.x1, n.y);
    take(n.x2, n.y);
    take(n.cx - 72, n.y - 20);
    take(n.cx + 72, n.y + 18);
  }
  for (const l of side.leaves || []) {
    take(l.x - 36, l.y - 12);
    take(l.x + 36, l.y + 4);
  }
  if (side.top) take(side.top.cx, side.top.y - 30);
  const pad = 10;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const dx = -minX;
  const dy = -minY;
  const move = (n) => ({
    ...n,
    x1: n.x1 + dx,
    x2: n.x2 + dx,
    cx: (n.cx || 0) + dx,
    y: (n.y || 0) + dy,
    y1: n.y1 != null ? n.y1 + dy : n.y1,
    y2: n.y2 != null ? n.y2 + dy : n.y2,
  });
  return {
    nodes: side.nodes.map(move),
    leaves: (side.leaves || []).map((l) => ({ ...l, x: l.x + dx, y: l.y + dy })),
    top: side.top ? move(side.top) : null,
    width: Math.ceil(maxX - minX),
    height: Math.ceil(maxY - minY),
  };
}

function offsetBox(box, dy) {
  if (!box) return null;
  const bump = (n) => ({
    ...n,
    y: (n.y || 0) + dy,
    y1: n.y1 != null ? n.y1 + dy : n.y1,
    y2: n.y2 != null ? n.y2 + dy : n.y2,
  });
  return {
    ...box,
    height: (box.height || 0) + dy,
    nodes: (box.nodes || []).map(bump),
    leaves: (box.leaves || []).map((l) => ({ ...l, y: l.y + dy })),
    top: box.top ? bump(box.top) : null,
  };
}

/**
 * @param {{ winners?: Array, losers?: Array, grandFinal?: Array }} tracks
 */
export function buildDoubleElimTreeLayout(tracks) {
  let winners = layoutSide(tracks?.winners);
  let losersRaw = layoutSide(tracks?.losers);
  if (!winners && !losersRaw) return null;

  const shift = (winners?.width || 0) + (winners && losersRaw ? GAP : 0);
  let losers = shiftSide(losersRaw, winners ? shift : 0);

  const gfMatches = (tracks?.grandFinal || []).filter((m) => m.status !== 'cancelled');
  let gfNodes = [];

  if (winners?.top && losers?.top && gfMatches.length) {
    gfMatches.forEach((m, i) => {
      const y = Math.min(winners.top.y, losers.top.y) - ROW * (i + 1);
      const x1 = i === 0 ? winners.top.cx : gfNodes[i - 1].cx - SLOT * 0.45;
      const x2 = i === 0 ? losers.top.cx : gfNodes[i - 1].cx + SLOT * 0.45;
      const y1 = i === 0 ? winners.top.y : gfNodes[i - 1].y;
      const y2 = i === 0 ? losers.top.y : gfNodes[i - 1].y;
      gfNodes.push({
        ...nodeFrom(m, x1, x2, y, y1, y2),
        title: m.grandFinalLeg === 2 ? '總決賽 2' : '總決賽',
      });
    });
  } else if (winners?.top && gfMatches.length) {
    gfMatches.forEach((m, i) => {
      const y = winners.top.y - ROW * (i + 1);
      const x1 = winners.top.cx - SLOT;
      const x2 = winners.top.cx + SLOT;
      gfNodes.push({
        ...nodeFrom(m, x1, x2, y, winners.top.y, winners.top.y),
        title: m.grandFinalLeg === 2 ? '總決賽 2' : '總決賽',
      });
    });
  }

  const minY = Math.min(
    0,
    ...gfNodes.map((n) => n.y),
    winners?.top?.y ?? 0,
    losers?.top?.y ?? 0
  );
  const dy = 36 - minY;
  winners = offsetBox(winners, dy);
  losers = offsetBox(losers, dy);
  gfNodes = gfNodes.map((n) => ({
    ...n,
    y: n.y + dy,
    y1: n.y1 + dy,
    y2: n.y2 + dy,
  }));

  let maxX = Math.max(winners?.width || 0, 280);
  const bump = (x, extra = 0) => {
    if (typeof x === 'number' && Number.isFinite(x)) maxX = Math.max(maxX, x + extra);
  };
  const walk = (box) => {
    if (!box) return;
    for (const n of box.nodes || []) {
      bump(n.x1);
      bump(n.x2);
      bump(n.cx, 78);
    }
    for (const l of box.leaves || []) bump(l.x, 40);
    if (box.top) bump(box.top.cx, 28);
  };
  walk(winners);
  walk(losers);
  for (const n of gfNodes) {
    bump(n.x1);
    bump(n.x2);
    bump(n.cx, 48);
  }

  const height =
    Math.max(winners?.height || 0, losers?.height || 0, ...gfNodes.map((n) => Math.max(n.y1 || 0, n.y2 || 0, n.y || 0))) + 28;

  return {
    width: Math.ceil(maxX + PAD),
    height,
    winners,
    losers,
    winnersPanel: fitPanel(winners),
    losersPanel: fitPanel(losers),
    grandFinal: gfNodes,
  };
}
