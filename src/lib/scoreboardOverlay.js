import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const OVERLAY_DIR = path.join(ROOT, 'data', 'stream-overlays');

const FONT_CANDIDATES = [
  process.env.SCOREBOARD_FONT,
  path.join(ROOT, 'data', 'fonts', 'scoreboard.ttc'),
  '/System/Library/Fonts/STHeiti Light.ttc',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
].filter(Boolean);

let cachedFont = null;

function ensureBundledFont() {
  const dest = path.join(ROOT, 'data', 'fonts', 'scoreboard.ttc');
  if (fs.existsSync(dest)) return dest;
  const sources = [
    '/System/Library/Fonts/STHeiti Light.ttc',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  ];
  for (const src of sources) {
    try {
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      return dest;
    } catch {
      // ignore
    }
  }
  return '';
}

function resolveFont() {
  if (cachedFont !== null) return cachedFont;
  ensureBundledFont();
  for (const f of FONT_CANDIDATES) {
    try {
      if (f && fs.existsSync(f)) {
        cachedFont = f;
        return cachedFont;
      }
    } catch {
      // ignore
    }
  }
  cachedFont = '';
  return cachedFont;
}

function escapeDrawtext(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

function escapeFontPath(p) {
  return String(p)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/ /g, '\\ ')
    .replace(/'/g, "\\'");
}

function truncate(s, n) {
  const t = String(s || '').trim() || '—';
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function overlayPathFor(eventId, venueSlug) {
  fs.mkdirSync(OVERLAY_DIR, { recursive: true });
  const safe = String(venueSlug || 'court').replace(/[^a-z0-9_-]/gi, '_');
  return path.join(OVERLAY_DIR, `${eventId}_${safe}.png`);
}

/**
 * 產生右上角計分板 PNG（半透明底）。
 * @param {string} outputPath
 * @param {{ venueName?: string, teamA?: string, teamB?: string, scoreA?: number, scoreB?: number, games?: string, idle?: boolean, serving?: string }} info
 */
export function renderScoreboardPng(outputPath, info = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const font = resolveFont();
    const idle = !!info.idle;
    const serving = info.serving === 'a' || info.serving === 'b' ? info.serving : '';
    const venue = escapeDrawtext(truncate(info.venueName || '場地', 18));
    const scoreA = escapeDrawtext(String(info.scoreA ?? 0));
    const scoreB = escapeDrawtext(String(info.scoreB ?? 0));
    const games = escapeDrawtext(truncate(info.games || '—', 40));
    const status = escapeDrawtext(idle ? '等候下一場' : games);
    const serveA = serving === 'a';
    const serveB = serving === 'b';

    const fontOpt = font ? `fontfile=${escapeFontPath(font)}:` : '';
    // 約佔 1080p 畫面約 1/3 闊，方便手機／YouTube 都睇到
    const W = 960;
    const H = 300;
    const playersA = escapeDrawtext(truncate(info.playersA || '', 22));
    const playersB = escapeDrawtext(truncate(info.playersB || '', 22));
    const roundBit = info.roundLabel ? `${truncate(info.roundLabel, 10)} · ` : '';
    const aLabel = escapeDrawtext(
      `${serving === 'a' ? '◆ ' : ''}${truncate(info.teamA || '隊 A', 12)}${serving === 'a' ? '  發球' : ''}`
    );
    const bLabel = escapeDrawtext(
      `${serving === 'b' ? '◆ ' : ''}${truncate(info.teamB || '隊 B', 12)}${serving === 'b' ? '  發球' : ''}`
    );
    const statusText = escapeDrawtext(truncate(`${roundBit}${info.games || '—'}`, 48));
    const vf = [
      `drawtext=${fontOpt}text='${venue}':fontsize=34:fontcolor=0xcbd5e1:x=28:y=16`,
      idle
        ? `drawtext=${fontOpt}text='${status}':fontsize=64:fontcolor=white:x=28:y=110`
        : [
            `drawtext=${fontOpt}text='${aLabel}':fontsize=44:fontcolor=${serveA ? '0xfbbf24' : '0x34d399'}:x=28:y=58`,
            playersA
              ? `drawtext=${fontOpt}text='${playersA}':fontsize=28:fontcolor=0xa7f3d0:x=28:y=108`
              : null,
            `drawtext=${fontOpt}text='${scoreA}':fontsize=68:fontcolor=white:x=w-tw-28:y=58`,
            `drawtext=${fontOpt}text='${bLabel}':fontsize=44:fontcolor=${serveB ? '0xfbbf24' : '0x38bdf8'}:x=28:y=150`,
            playersB
              ? `drawtext=${fontOpt}text='${playersB}':fontsize=28:fontcolor=0xbae6fd:x=28:y=200`
              : null,
            `drawtext=${fontOpt}text='${scoreB}':fontsize=68:fontcolor=white:x=w-tw-28:y=150`,
            `drawtext=${fontOpt}text='${statusText}':fontsize=26:fontcolor=0x94a3b8:x=28:y=252`,
          ]
            .filter(Boolean)
            .join(','),
    ]
      .flat()
      .join(',');
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=0x0f172acc:s=${W}x${H}:d=0.2`,
      '-vf',
      vf,
      '-frames:v',
      '1',
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (c) => {
      err += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(err.trim() || `ffmpeg overlay exit ${code}`));
    });
  });
}
