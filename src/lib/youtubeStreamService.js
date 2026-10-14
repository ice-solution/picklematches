import { spawn } from 'child_process';
import fs from 'fs';
import { Event } from '../models/Event.js';
import { findLiveMatchOnCourt } from './courtLive.js';
import { findVenue, normalizeEventVenues } from './venues.js';
import { overlayPathFor, renderScoreboardPng } from './scoreboardOverlay.js';
import { scoreDisplayParts } from './viewHelpers.js';
import { isLeagueFormat, LEAGUE_GAME_LABELS, leagueGameLabel } from './leagueRules.js';
import { resolveCurrentPlayers } from './leagueLineup.js';

/**
 * @typedef {{
 *   eventId: string,
 *   venueSlug: string,
 *   proc: import('child_process').ChildProcess,
 *   startedAt: number,
 *   lastError: string|null,
 *   overlayPath: string,
 *   overlayIn: import('stream').Writable|null,
 *   timer: NodeJS.Timeout|null,
 *   lastFingerprint: string,
 *   lastPng: Buffer|null,
 * }} StreamJob
 */

/** @type {Map<string, StreamJob>} */
const jobs = new Map();

function jobKey(eventId, venueSlug) {
  return `${eventId}:${venueSlug}`;
}

function defaultRtmpServer() {
  return process.env.YOUTUBE_RTMP_SERVER || 'rtmp://a.rtmp.youtube.com/live2';
}

function buildRtmpUrl(venue) {
  const server = String(venue.youtubeRtmpServer || defaultRtmpServer())
    .trim()
    .replace(/\/$/, '');
  const key = String(venue.youtubeStreamKey || '').trim();
  if (!server || !key) return null;
  return `${server}/${key}`;
}

function overlayGamesLine(match) {
  if (isLeagueFormat(match?.matchFormat)) {
    const { main } = scoreDisplayParts(match);
    const idx = Array.isArray(match?.completedGames) ? match.completedGames.length : 0;
    return `${main} · ${leagueGameLabel(idx)}`;
  }
  const games = Array.isArray(match?.completedGames) ? match.completedGames : [];
  if (!games.length) return '進行中';
  return games.map((g) => `${g.a ?? 0}-${g.b ?? 0}`).join(' · ');
}

function fingerprint(info) {
  return JSON.stringify(info);
}

async function scoreboardInfo(event, venueSlug) {
  const venue = findVenue(event.venues, venueSlug);
  const match = await findLiveMatchOnCourt(event, venueSlug);
  if (!match) {
    return {
      venueName: venue?.name || venueSlug,
      idle: true,
      teamA: '',
      teamB: '',
      playersA: '',
      playersB: '',
      roundLabel: '',
      scoreA: 0,
      scoreB: 0,
      games: '',
    };
  }
  const idx = Array.isArray(match.completedGames) ? match.completedGames.length : 0;
  const players = isLeagueFormat(match.matchFormat) ? resolveCurrentPlayers(match) : { playersA: [], playersB: [] };
  const join = (arr) => (arr || []).filter(Boolean).join('/');
  return {
    venueName: venue?.name || venueSlug,
    idle: false,
    teamA: match.teamA?.name || match.teamA?.code || '隊 A',
    teamB: match.teamB?.name || match.teamB?.code || '隊 B',
    playersA: join(players.playersA),
    playersB: join(players.playersB),
    roundLabel: isLeagueFormat(match.matchFormat) ? LEAGUE_GAME_LABELS[idx] || '' : '',
    scoreA: Number(match.currentPoints?.a ?? 0),
    scoreB: Number(match.currentPoints?.b ?? 0),
    games: overlayGamesLine(match),
    serving: match.serving === 'a' || match.serving === 'b' ? match.serving : '',
  };
}

function writeOverlayFrame(job, force = false) {
  const stream = job.overlayIn;
  if (!stream || stream.destroyed || !job.lastPng) return;
  try {
    // image2pipe 要持續有 frame；分數未變都照餵，避免 ffmpeg 卡住
    stream.write(job.lastPng);
  } catch (err) {
    if (force) {
      job.lastError = err.message || String(err);
    }
  }
}

async function refreshOverlay(job, event, { forceWrite = false } = {}) {
  try {
    const info = await scoreboardInfo(event, job.venueSlug);
    const fp = fingerprint(info);
    if (fp !== job.lastFingerprint || !job.lastPng) {
      await renderScoreboardPng(job.overlayPath, info);
      job.lastPng = fs.readFileSync(job.overlayPath);
      job.lastFingerprint = fp;
    }
    writeOverlayFrame(job, forceWrite);
  } catch (err) {
    job.lastError = err.message || String(err);
    console.warn(`[stream ${job.venueSlug}] overlay:`, job.lastError);
    // 即使 render 失敗，都盡量重餵舊圖維持 pipeline
    writeOverlayFrame(job);
  }
}

function stopProc(job) {
  return new Promise((resolve) => {
    const proc = job?.proc;
    try {
      if (job.overlayIn && !job.overlayIn.destroyed) job.overlayIn.end();
    } catch {
      // ignore
    }
    if (!proc || proc.killed || proc.exitCode !== null) {
      resolve();
      return;
    }
    const t = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, 6000);
    proc.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
    try {
      if (proc.stdin && !proc.stdin.destroyed) proc.stdin.write('q');
      else proc.kill('SIGINT');
    } catch {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  });
}

/**
 * @returns {{ live: boolean, startedAt?: string, lastError?: string|null, hasConfig?: boolean }}
 */
export function getStreamStatus(eventId, venueSlug) {
  const job = jobs.get(jobKey(eventId, venueSlug));
  if (!job) return { live: false };
  return {
    live: true,
    startedAt: new Date(job.startedAt).toISOString(),
    lastError: job.lastError,
  };
}

export function getAllStreamStatuses(eventId, venues) {
  const list = normalizeEventVenues(venues);
  const out = {};
  for (const v of list) {
    const st = getStreamStatus(String(eventId), v.slug);
    out[v.slug] = {
      ...st,
      hasConfig: !!(String(v.streamRtspUrl || '').trim() && String(v.youtubeStreamKey || '').trim()),
    };
  }
  return out;
}

export async function startVenueStream(eventId, venueSlug) {
  const key = jobKey(eventId, venueSlug);
  if (jobs.has(key)) {
    return { ok: true, already: true, status: getStreamStatus(eventId, venueSlug) };
  }

  const event = await Event.findById(eventId).lean();
  if (!event) {
    const err = new Error('event_not_found');
    throw err;
  }
  const venue = findVenue(event.venues, venueSlug);
  if (!venue) {
    const err = new Error('venue_not_found');
    throw err;
  }

  const rtsp = String(venue.streamRtspUrl || '').trim();
  const rtmp = buildRtmpUrl(venue);
  if (!rtsp) {
    const err = new Error('missing_rtsp');
    throw err;
  }
  if (!rtmp) {
    const err = new Error('missing_youtube');
    throw err;
  }

  const overlayPath = overlayPathFor(eventId, venue.slug);
  const info = await scoreboardInfo(event, venue.slug);
  await renderScoreboardPng(overlayPath, info);
  const firstPng = fs.readFileSync(overlayPath);

  // FFmpeg 8 已無 image2 -update；改用 image2pipe 持續餵 PNG，計分板可即時變
  const args = [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-rtsp_transport',
    'tcp',
    '-i',
    rtsp,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-f',
    'image2pipe',
    '-framerate',
    '2',
    '-c:v',
    'png',
    '-i',
    'pipe:3',
    '-filter_complex',
    '[0:v][2:v]overlay=W-w-36:36:format=auto[v]',
    '-map',
    '[v]',
    '-map',
    '1:a',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    process.env.YOUTUBE_VIDEO_BITRATE || '2500k',
    '-maxrate',
    process.env.YOUTUBE_VIDEO_BITRATE || '2500k',
    '-bufsize',
    '5000k',
    '-g',
    '60',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '44100',
    '-f',
    'flv',
    rtmp,
  ];

  const proc = spawn('ffmpeg', args, {
    stdio: ['pipe', 'ignore', 'pipe', 'pipe'],
  });
  /** @type {StreamJob} */
  const job = {
    eventId: String(eventId),
    venueSlug: venue.slug,
    proc,
    startedAt: Date.now(),
    lastError: null,
    overlayPath,
    overlayIn: proc.stdio[3],
    timer: null,
    lastFingerprint: fingerprint(info),
    lastPng: firstPng,
  };
  jobs.set(key, job);

  // 先餵幾幀，等 RTSP 連線時 overlay 已經 ready
  writeOverlayFrame(job, true);
  writeOverlayFrame(job);
  writeOverlayFrame(job);

  proc.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim();
    if (!line) return;
    if (/error|fail|invalid|denied/i.test(line)) {
      job.lastError = line.slice(0, 240);
    }
    console.warn(`[stream ${venue.slug}] ${line.slice(0, 200)}`);
  });

  proc.on('exit', (code, signal) => {
    const cur = jobs.get(key);
    if (cur?.proc === proc) {
      if (cur.timer) clearInterval(cur.timer);
      try {
        if (cur.overlayIn && !cur.overlayIn.destroyed) cur.overlayIn.end();
      } catch {
        // ignore
      }
      jobs.delete(key);
    }
    if (code && code !== 0) {
      console.warn(`[stream ${venue.slug}] exited code=${code} signal=${signal || ''}`);
    }
  });

  job.timer = setInterval(() => {
    Event.findById(eventId)
      .lean()
      .then((ev) => {
        if (ev) return refreshOverlay(job, ev);
      })
      .catch(() => {
        writeOverlayFrame(job);
      });
  }, 500);

  return { ok: true, status: getStreamStatus(eventId, venue.slug) };
}

export async function stopVenueStream(eventId, venueSlug) {
  const key = jobKey(eventId, venueSlug);
  const job = jobs.get(key);
  if (!job) return { ok: true, already: true };
  if (job.timer) clearInterval(job.timer);
  jobs.delete(key);
  await stopProc(job);
  return { ok: true };
}

export async function stopAllStreamsForEvent(eventId) {
  const prefix = `${eventId}:`;
  const keys = [...jobs.keys()].filter((k) => k.startsWith(prefix));
  for (const k of keys) {
    const [, slug] = k.split(':');
    await stopVenueStream(eventId, slug);
  }
}
