import { Router } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
import { Tournament } from '../models/Tournament.js';
import { Group } from '../models/Group.js';
import { Team } from '../models/Team.js';
import { Match, MATCH_FORMAT } from '../models/Match.js';
import { MatchAssignment } from '../models/MatchAssignment.js';
import { requireStaff } from '../middleware/auth.js';
import { toDatetimeLocalValue, parseDatetimeLocal, normalizeDateOnly } from '../lib/datetime.js';
import { normalizeTimeToHHmm, timeInputValueFromMatch } from '../lib/matchTime.js';
import { uploadMatchXlsx } from '../middleware/uploadMatchXlsx.js';
import {
  parseMatchWorkbookBuffer,
  importMatchesFromRows,
  buildMatchImportTemplateSheet,
} from '../lib/matchImport.js';
import {
  parseTeamWorkbookBuffer,
  importTeamsFromRows,
  buildTeamImportTemplateSheet,
} from '../lib/teamImport.js';
import {
  parseTournamentWorkbookBuffer,
  importTournamentsFromRows,
  buildTournamentImportTemplateSheet,
} from '../lib/tournamentImport.js';
import { buildKnockoutLadderColumns } from '../lib/knockoutLadder.js';
import { getEventGroupStandings } from '../lib/groupStandings.js';
import { finalizeFinishedMatch, applyManualScoresFromBody } from '../lib/matchResult.js';
import { broadcastMatchUpdate } from '../lib/matchSocket.js';
import { normalizeLoginId, LOGIN_ID_RE } from '../lib/loginId.js';
import { generateKnockoutFromGroup } from '../lib/knockoutGenerator.js';
import { syncTeamCodesForTournament } from '../lib/teamCodes.js';
import { getOrCreateScoreboard } from '../models/LiveScoreboard.js';
import { LiveScoreboard } from '../models/LiveScoreboard.js';

export const adminRouter = Router();

adminRouter.use((req, res, next) => {
  res.locals.adminPath = req.originalUrl.split('?')[0];
  next();
});

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 指派／取消指派後導回賽事頁等內部路徑 */
function adminRedirectTarget(raw, fallbackPath) {
  const u = String(raw || '').trim();
  if (u.startsWith('/admin/') && !u.includes('\n') && !u.includes('\r')) return u;
  return fallbackPath;
}

function normalizeSlug(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
}

adminRouter.get('/login', (req, res) => {
  if (req.session?.userId && ['admin', 'staff'].includes(req.session.role)) {
    return res.redirect('/admin');
  }
  res.render('pages/admin-login', { title: '管理後台登入', error: null, next: req.query.next || '' });
});

adminRouter.post('/login', async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const password = String(req.body.password || '');
  const user = await User.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).render('pages/admin-login', {
      title: '管理後台登入',
      error: '電子郵件或密碼錯誤',
      next: req.body.next || '',
    });
  }
  if (!['admin', 'staff'].includes(user.role)) {
    return res.status(403).render('pages/admin-login', {
      title: '管理後台登入',
      error: '此帳號非管理端使用者',
      next: req.body.next || '',
    });
  }
  req.session.userId = user._id.toString();
  req.session.role = user.role;
  req.session.email = user.email;
  const next = req.body.next || '/admin';
  res.redirect(next.startsWith('/') ? next : '/admin');
});

adminRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

adminRouter.get('/', requireStaff, async (req, res, next) => {
  try {
    const events = await Event.find().sort({ createdAt: -1 }).lean();
    res.render('pages/admin-dashboard', {
      title: '管理後台',
      events,
      userEmail: req.session.email,
      role: req.session.role,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/referees', requireStaff, async (req, res, next) => {
  try {
    const referees = await User.find({ role: 'referee' }).sort({ createdAt: -1 }).lean();
    const counts = await MatchAssignment.aggregate([
      { $match: { refereeId: { $exists: true } } },
      { $group: { _id: '$refereeId', n: { $sum: 1 } } },
    ]);
    const nByRef = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
    referees.forEach((r) => {
      r.assignCount = nByRef[String(r._id)] || 0;
    });

    let notice = null;
    let pageError = null;
    if (req.query.created === '1') notice = '已新增球證帳號。';
    if (req.query.deleted === '1') notice = '已刪除球證帳號。';
    if (req.query.err === '1') {
      pageError = '請填寫有效登入 ID（英數小寫開頭，3–32 字，可含 _ -）、信箱與密碼（至少 6 字）。';
    }
    if (req.query.err === '2') pageError = '此信箱已被使用。';
    if (req.query.err === '3') pageError = '此登入 ID 已被使用。';
    if (req.query.err === 'dup') pageError = '登入 ID 或信箱與現有帳號重複。';
    if (req.query.err === 'assigned') pageError = '該球證仍有被指派的場次，請先取消指派再刪除。';

    res.render('pages/admin-referees', {
      title: '球證管理',
      referees,
      userEmail: req.session.email,
      notice,
      error: pageError,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/referees', requireStaff, async (req, res, next) => {
  try {
    const loginId = normalizeLoginId(req.body.loginId);
    const email = String(req.body.email || '').toLowerCase().trim();
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim();
    if (!LOGIN_ID_RE.test(loginId) || !email || password.length < 6) {
      return res.redirect('/admin/referees?err=1');
    }
    if (await User.findOne({ email })) return res.redirect('/admin/referees?err=2');
    if (await User.findOne({ loginId })) return res.redirect('/admin/referees?err=3');
    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ email, loginId, passwordHash, role: 'referee', name });
    res.redirect('/admin/referees?created=1');
  } catch (e) {
    if (e.code === 11000) return res.redirect('/admin/referees?err=dup');
    next(e);
  }
});

adminRouter.post('/referees/:userId/delete', requireStaff, async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) return res.redirect('/admin/referees');
    const user = await User.findById(userId);
    if (!user || user.role !== 'referee') return res.redirect('/admin/referees');
    const n = await MatchAssignment.countDocuments({ refereeId: userId });
    if (n > 0) return res.redirect('/admin/referees?err=assigned');
    await User.deleteOne({ _id: userId });
    res.redirect('/admin/referees?deleted=1');
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/events/new', requireStaff, (req, res) => {
  res.render('pages/admin-event-new', {
    title: '新增大會',
    userEmail: req.session.email,
    error: null,
  });
});

adminRouter.post('/events', requireStaff, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const slug = normalizeSlug(req.body.slug);
    if (!name) {
      return res.status(400).render('pages/admin-event-new', {
        title: '新增大會',
        userEmail: req.session.email,
        error: '請填寫大會名稱',
      });
    }
    if (!SLUG_RE.test(slug)) {
      return res.status(400).render('pages/admin-event-new', {
        title: '新增大會',
        userEmail: req.session.email,
        error: 'slug 僅能使用小寫英文、數字與連字號',
      });
    }
    const venues = String(req.body.venues || '')
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean);
    const dateStart = parseDatetimeLocal(req.body.dateStart);
    const dateEnd = parseDatetimeLocal(req.body.dateEnd);
    const event = await Event.create({
      name,
      slug,
      venues,
      dateStart,
      dateEnd,
      isActive: true,
    });
    res.redirect(`/admin/events/${event._id}`);
  } catch (e) {
    if (e.code === 11000) {
      return res.status(400).render('pages/admin-event-new', {
        title: '新增大會',
        userEmail: req.session.email,
        error: '此 slug 已被使用',
      });
    }
    next(e);
  }
});

adminRouter.get('/events/:eventId/matches-summary', requireStaff, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) return res.status(404).send('Not found');
    const event = await Event.findById(eventId).lean();
    if (!event) return res.status(404).send('Not found');
    const tournaments = await Tournament.find({ eventId: event._id }).sort({ order: 1, createdAt: 1 }).lean();
    const tids = tournaments.map((t) => t._id);
    const tName = Object.fromEntries(tournaments.map((t) => [String(t._id), t.name]));
    const matches = await Match.find({ tournamentId: { $in: tids } })
      .populate('teamA teamB winnerId')
      .sort({ scheduledTime: 1, createdAt: 1 })
      .lean();
    matches.forEach((m) => {
      m.tournamentName = tName[String(m.tournamentId)] || '—';
    });
    const groupStandingsList = await getEventGroupStandings(event._id);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const publicEventUrl = `${baseUrl}/e/${event.slug}`;

    res.render('pages/admin-event-matches', {
      title: `賽果總覽 — ${event.name}`,
      event,
      tournaments,
      matches,
      groupStandingsList,
      publicEventUrl,
      userEmail: req.session.email,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/events/:eventId', requireStaff, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) return res.status(404).send('Not found');
    const event = await Event.findById(eventId).lean();
    if (!event) return res.status(404).send('Not found');
    const tournaments = await Tournament.find({ eventId: event._id }).sort({ order: 1, createdAt: 1 }).lean();
    let error = null;
    if (req.query.error === 'slug') error = 'slug 僅能使用小寫英文、數字與連字號';
    if (req.query.error === 'taken') error = '此 slug 已被其他大會使用';
    if (req.query.error === '1') error = '請填寫大會名稱';

    let flash = null;
    if (req.query.saved === '1') flash = '已儲存';
    if (req.query.deleted === '1') flash = '已刪除賽事';

    let tournamentImportReport = null;
    if (req.session.tournamentImportReport) {
      tournamentImportReport = req.session.tournamentImportReport;
      delete req.session.tournamentImportReport;
    }

    res.render('pages/admin-event', {
      title: `設定 — ${event.name}`,
      event,
      tournaments,
      userEmail: req.session.email,
      flash,
      error,
      dateStartLocal: toDatetimeLocalValue(event.dateStart),
      dateEndLocal: toDatetimeLocalValue(event.dateEnd),
      tournamentImportReport,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/events/:eventId/scoreboard', requireStaff, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) return res.status(404).send('Not found');
    const event = await Event.findById(eventId).lean();
    if (!event) return res.status(404).send('Not found');
    const [board1, board2] = await Promise.all([
      getOrCreateScoreboard(event._id, 1),
      getOrCreateScoreboard(event._id, 2),
    ]);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const urls = {
      display1: `${baseUrl}/e/${event.slug}/scoreboard`,
      obs1: `${baseUrl}/e/${event.slug}/scoreboard?obs=1`,
      display2: `${baseUrl}/e/${event.slug}/scoreboard/2`,
      obs2: `${baseUrl}/e/${event.slug}/scoreboard/2?obs=1`,
      json1: `${baseUrl}/api/public/events/${event.slug}/scoreboard?slot=1`,
      json2: `${baseUrl}/api/public/events/${event.slug}/scoreboard?slot=2`,
    };

    res.render('pages/admin-scoreboard', {
      title: `大會計分牌 — ${event.name}`,
      event,
      scoreboard: board1.toObject(),
      scoreboard2: board2.toObject(),
      userEmail: req.session.email,
      urls,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/events/:eventId/update', requireStaff, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) return res.status(404).send('Not found');
    const doc = await Event.findById(eventId);
    if (!doc) return res.status(404).send('Not found');

    const name = String(req.body.name || '').trim();
    const newSlug = normalizeSlug(req.body.slug);
    if (!name) {
      return res.redirect(`/admin/events/${eventId}?error=1`);
    }
    if (!SLUG_RE.test(newSlug)) {
      return res.redirect(`/admin/events/${eventId}?error=slug`);
    }

    const other = await Event.findOne({ slug: newSlug, _id: { $ne: doc._id } });
    if (other) {
      return res.redirect(`/admin/events/${eventId}?error=taken`);
    }

    if (doc.slug !== newSlug) {
      doc.slugHistory = doc.slugHistory || [];
      doc.slugHistory.push({ slug: doc.slug, changedAt: new Date() });
      const aliases = new Set(doc.slugAliases || []);
      aliases.add(doc.slug);
      doc.slugAliases = [...aliases];
      doc.slug = newSlug;
    }

    doc.name = name;
    doc.dateStart = parseDatetimeLocal(req.body.dateStart) || undefined;
    doc.dateEnd = parseDatetimeLocal(req.body.dateEnd) || undefined;
    doc.venues = String(req.body.venues || '')
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean);
    doc.isActive = req.body.isActive === '1';

    await doc.save();
    res.redirect(`/admin/events/${eventId}?saved=1`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/events/:eventId/tournaments', requireStaff, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) return res.status(404).send('Not found');
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).send('Not found');

    const name = String(req.body.name || '').trim();
    const phase = req.body.phase === 'knockout' ? 'knockout' : 'group';
    const advancePerGroup = Math.max(1, parseInt(req.body.advancePerGroup, 10) || 2);
    if (!name) {
      return res.redirect(`/admin/events/${eventId}`);
    }

    const maxOrder = await Tournament.findOne({ eventId }).sort({ order: -1 }).select('order').lean();
    const order = (maxOrder?.order ?? -1) + 1;

    const competitionDate = normalizeDateOnly(req.body.competitionDate);
    const t = await Tournament.create({
      eventId,
      name,
      phase,
      advancePerGroup,
      order,
      competitionDate: competitionDate || '',
    });
    res.redirect(`/admin/tournaments/${t._id}`);
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/events/:eventId/import-tournaments-template', requireStaff, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) return res.status(404).send('Not found');
    const event = await Event.findById(eventId).lean();
    if (!event) return res.status(404).send('Not found');

    const buf = buildTournamentImportTemplateSheet();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="tournament-import-template.xlsx"');
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

adminRouter.post(
  '/events/:eventId/import-tournaments',
  requireStaff,
  (req, res, next) => {
    uploadMatchXlsx.single('file')(req, res, (err) => {
      if (err) {
        req.session.tournamentImportReport = { error: '上傳失敗或檔案類型不符（請用 .xlsx / .xls / .csv）' };
        return res.redirect(`/admin/events/${req.params.eventId}`);
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      const { eventId } = req.params;
      if (!mongoose.isValidObjectId(eventId)) return res.status(404).send('Not found');
      const event = await Event.findById(eventId);
      if (!event) return res.status(404).send('Not found');

      if (!req.file?.buffer) {
        req.session.tournamentImportReport = { error: '請選擇檔案' };
        return res.redirect(`/admin/events/${eventId}`);
      }

      const { rows, parseErrors } = parseTournamentWorkbookBuffer(req.file.buffer);
      if (!rows.length) {
        req.session.tournamentImportReport = {
          createdCount: 0,
          parseErrors: parseErrors || [],
          rowErrors: [],
          error: parseErrors?.length ? null : '沒有可匯入的資料列',
        };
        return res.redirect(`/admin/events/${eventId}`);
      }

      const { createdCount, errors } = await importTournamentsFromRows(eventId, rows);
      req.session.tournamentImportReport = {
        createdCount,
        parseErrors: parseErrors || [],
        rowErrors: errors || [],
      };
      res.redirect(`/admin/events/${eventId}`);
    } catch (e) {
      next(e);
    }
  }
);

adminRouter.get('/tournaments/:tournamentId/import-template', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');
    const tournament = await Tournament.findById(tournamentId).lean();
    if (!tournament) return res.status(404).send('Not found');

    const buf = buildMatchImportTemplateSheet();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="match-import-template.xlsx"');
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

adminRouter.post(
  '/tournaments/:tournamentId/import-matches',
  requireStaff,
  (req, res, next) => {
    uploadMatchXlsx.single('file')(req, res, (err) => {
      if (err) {
        req.session.importReport = { error: '上傳失敗或檔案類型不符（請用 .xlsx / .xls / .csv）' };
        return res.redirect(`/admin/tournaments/${req.params.tournamentId}`);
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      const { tournamentId } = req.params;
      if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');
      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) return res.status(404).send('Not found');

      if (!req.file?.buffer) {
        req.session.importReport = { error: '請選擇檔案' };
        return res.redirect(`/admin/tournaments/${tournamentId}`);
      }

      const { rows, parseErrors } = parseMatchWorkbookBuffer(req.file.buffer);
      if (!rows.length) {
        req.session.importReport = {
          createdCount: 0,
          parseErrors: parseErrors || [],
          rowErrors: [],
          error: parseErrors?.length ? null : '沒有可匯入的資料列',
        };
        return res.redirect(`/admin/tournaments/${tournamentId}`);
      }

      const { createdCount, errors } = await importMatchesFromRows(tournamentId, rows);
      req.session.importReport = {
        createdCount,
        parseErrors: parseErrors || [],
        rowErrors: errors || [],
      };
      res.redirect(`/admin/tournaments/${tournamentId}`);
    } catch (e) {
      next(e);
    }
  }
);

adminRouter.get('/tournaments/:tournamentId/import-teams-template', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');
    const tournament = await Tournament.findById(tournamentId).lean();
    if (!tournament) return res.status(404).send('Not found');

    const buf = buildTeamImportTemplateSheet();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="team-import-template.xlsx"');
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

adminRouter.post(
  '/tournaments/:tournamentId/import-teams',
  requireStaff,
  (req, res, next) => {
    uploadMatchXlsx.single('file')(req, res, (err) => {
      if (err) {
        req.session.teamImportReport = { error: '上傳失敗或檔案類型不符（請用 .xlsx / .xls / .csv）' };
        return res.redirect(`/admin/tournaments/${req.params.tournamentId}`);
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      const { tournamentId } = req.params;
      if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');
      const tournament = await Tournament.findById(tournamentId);
      if (!tournament) return res.status(404).send('Not found');

      if (!req.file?.buffer) {
        req.session.teamImportReport = { error: '請選擇檔案' };
        return res.redirect(`/admin/tournaments/${tournamentId}`);
      }

      const { rows, parseErrors } = parseTeamWorkbookBuffer(req.file.buffer);
      if (!rows.length) {
        req.session.teamImportReport = {
          createdCount: 0,
          parseErrors: parseErrors || [],
          rowErrors: [],
          error: parseErrors?.length ? null : '沒有可匯入的資料列',
        };
        return res.redirect(`/admin/tournaments/${tournamentId}`);
      }

      const { createdCount, errors } = await importTeamsFromRows(tournamentId, rows);
      req.session.teamImportReport = {
        createdCount,
        parseErrors: parseErrors || [],
        rowErrors: errors || [],
      };
      res.redirect(`/admin/tournaments/${tournamentId}`);
    } catch (e) {
      next(e);
    }
  }
);

adminRouter.get('/tournaments/:tournamentId', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');
    const tournament = await Tournament.findById(tournamentId).lean();
    if (!tournament) return res.status(404).send('Not found');
    const event = await Event.findById(tournament.eventId).lean();
    if (!event) return res.status(404).send('Not found');
    const allTournaments = await Tournament.find({ eventId: event._id }).sort({ order: 1, createdAt: 1 }).lean();
    const groupTournaments = allTournaments.filter((t) => t.phase === 'group' && String(t._id) !== String(tournament._id));

    const groups = await Group.find({ tournamentId }).sort({ order: 1, createdAt: 1 }).lean();
    let teams = await Team.find({ tournamentId }).sort({ createdAt: 1 }).lean();
    const matches = await Match.find({ tournamentId })
      .populate('teamA teamB winnerId')
      .sort({ scheduledTime: 1, createdAt: 1 })
      .lean();

    const refereeUsers = await User.find({ role: 'referee' }).sort({ email: 1 }).lean();
    const matchIds = matches.map((m) => m._id);
    const assignmentByMatchId = Object.fromEntries(matchIds.map((id) => [String(id), []]));
    if (matchIds.length) {
      const assigns = await MatchAssignment.find({ matchId: { $in: matchIds } })
        .populate('refereeId', 'email name')
        .lean();
      for (const a of assigns) {
        const mid = String(a.matchId);
        if (assignmentByMatchId[mid] !== undefined && a.refereeId) {
          assignmentByMatchId[mid].push(a.refereeId);
        }
      }
    }

    const knockoutLadderColumns =
      tournament.phase === 'knockout' ? buildKnockoutLadderColumns(matches) : [];

    if (tournament.phase === 'group') {
      await syncTeamCodesForTournament(tournamentId);
      teams = await Team.find({ tournamentId }).sort({ createdAt: 1 }).lean();
    }

    let importReport = null;
    if (req.session.importReport) {
      importReport = req.session.importReport;
      delete req.session.importReport;
    }

    let teamImportReport = null;
    if (req.session.teamImportReport) {
      teamImportReport = req.session.teamImportReport;
      delete req.session.teamImportReport;
    }

    res.render('pages/admin-tournament', {
      title: `${tournament.name} — 賽程`,
      event,
      tournament,
      groupTournaments,
      groups,
      teams,
      matches,
      refereeUsers,
      assignmentByMatchId,
      userEmail: req.session.email,
      flash: req.query.saved === '1' ? '已儲存' : null,
      error: null,
      importReport,
      teamImportReport,
      knockoutLadderColumns,
      query: req.query,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/tournaments/:tournamentId/link-group', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament || tournament.phase !== 'knockout') {
      return res.redirect(`/admin/tournaments/${tournamentId}`);
    }
    const sid = String(req.body.sourceGroupTournamentId || '').trim();
    if (sid && mongoose.isValidObjectId(sid)) {
      const src = await Tournament.findOne({
        _id: sid,
        eventId: tournament.eventId,
        phase: 'group',
      }).lean();
      if (!src) {
        return res.redirect(`/admin/tournaments/${tournamentId}?link=invalid`);
      }
      tournament.sourceGroupTournamentId = src._id;
    } else {
      tournament.sourceGroupTournamentId = undefined;
    }
    await tournament.save();
    res.redirect(`/admin/tournaments/${tournamentId}?link=ok`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/tournaments/:tournamentId/generate-knockout', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    const sourceTournamentId = String(req.body.sourceTournamentId || '').trim();
    const advancePerGroup = parseInt(String(req.body.advancePerGroup || '').trim(), 10);
    const r = await generateKnockoutFromGroup({
      sourceTournamentId,
      knockoutTournamentId: tournamentId,
      advancePerGroup: Number.isNaN(advancePerGroup) ? undefined : advancePerGroup,
    });
    if (!r.ok) {
      const code = r.error || 'error';
      return res.redirect(`/admin/tournaments/${tournamentId}?gen=${encodeURIComponent(code)}`);
    }
    const qs = [`gen=ok`, `teams=${r.createdTeams}`];
    if (r.createdMatches) qs.push(`matches=${r.createdMatches}`);
    if (r.updatedMatches) qs.push(`updated=${r.updatedMatches}`);
    res.redirect(`/admin/tournaments/${tournamentId}?${qs.join('&')}`);
  } catch (e) {
    next(e);
  }
});

/** 清空本賽事所有場次（保留組別與隊伍，可重新匯入賽程） */
adminRouter.post('/tournaments/:tournamentId/clear-matches', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');
    const tournament = await Tournament.findById(tournamentId).lean();
    if (!tournament) return res.status(404).send('Not found');

    const matches = await Match.find({ tournamentId }).select('_id').lean();
    const matchIds = matches.map((m) => m._id);
    let removed = 0;

    if (matchIds.length) {
      await MatchAssignment.deleteMany({ matchId: { $in: matchIds } });
      await LiveScoreboard.updateMany(
        { linkedMatchId: { $in: matchIds } },
        { $set: { linkedMatchId: null, linkedMatchFormat: null } }
      );
      const r = await Match.deleteMany({ _id: { $in: matchIds } });
      removed = r.deletedCount || 0;
    }

    res.redirect(`/admin/tournaments/${tournamentId}?schedule_cleared=${removed}`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/tournaments/:tournamentId/reset-knockout', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');
    const t = await Tournament.findById(tournamentId).lean();
    if (!t) return res.status(404).send('Not found');
    if (t.phase !== 'knockout') return res.redirect(`/admin/tournaments/${tournamentId}`);

    const matches = await Match.find({ tournamentId }).select('_id').lean();
    const matchIds = matches.map((m) => m._id);
    if (matchIds.length) {
      await MatchAssignment.deleteMany({ matchId: { $in: matchIds } });
      await Match.deleteMany({ _id: { $in: matchIds } });
    }

    // 刪除自動產生的隊伍（出線隊、TBD/BYE）
    await Team.deleteMany({ tournamentId, $or: [{ isPlaceholder: true }, { sourceTeamId: { $exists: true, $ne: null } }] });

    res.redirect(`/admin/tournaments/${tournamentId}?gen=reset`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/tournaments/:tournamentId/update', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    const doc = await Tournament.findById(tournamentId);
    if (!doc) return res.status(404).send('Not found');
    const name = String(req.body.name || '').trim();
    const advancePerGroup = Math.max(1, parseInt(req.body.advancePerGroup, 10) || 1);
    if (!name) return res.redirect(`/admin/tournaments/${tournamentId}`);
    doc.name = name;
    doc.advancePerGroup = advancePerGroup;
    doc.competitionDate = normalizeDateOnly(req.body.competitionDate) || '';
    if (doc.phase === 'group') {
      const winPts = parseInt(String(req.body.groupWinPoints ?? '').trim(), 10);
      const lossPts = parseInt(String(req.body.groupLossPoints ?? '').trim(), 10);
      if (!Number.isNaN(winPts)) doc.groupWinPoints = winPts;
      if (!Number.isNaN(lossPts)) doc.groupLossPoints = lossPts;
    }
    await doc.save();
    res.redirect(`/admin/tournaments/${tournamentId}?saved=1`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/tournaments/:tournamentId/delete', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');
    const tournament = await Tournament.findById(tournamentId);
    if (!tournament) return res.status(404).send('Not found');
    const eventId = tournament.eventId.toString();

    const matches = await Match.find({ tournamentId }).select('_id').lean();
    const matchIds = matches.map((m) => m._id);
    if (matchIds.length) {
      await MatchAssignment.deleteMany({ matchId: { $in: matchIds } });
    }
    await Match.deleteMany({ tournamentId });
    await Team.deleteMany({ tournamentId });
    await Group.deleteMany({ tournamentId });
    await Tournament.deleteOne({ _id: tournamentId });

    res.redirect(`/admin/events/${eventId}?deleted=1`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/tournaments/:tournamentId/groups', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');
    const t = await Tournament.findById(tournamentId);
    if (!t) return res.status(404).send('Not found');

    const name = String(req.body.name || '').trim();
    if (!name) return res.redirect(`/admin/tournaments/${tournamentId}`);

    const maxOrder = await Group.findOne({ tournamentId }).sort({ order: -1 }).select('order').lean();
    const order = (maxOrder?.order ?? -1) + 1;
    await Group.create({ tournamentId, name, order });
    res.redirect(`/admin/tournaments/${tournamentId}`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/tournaments/:tournamentId/teams', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');
    const t = await Tournament.findById(tournamentId);
    if (!t) return res.status(404).send('Not found');

    const name = String(req.body.name || '').trim();
    const groupIdRaw = String(req.body.groupId || '').trim();
    if (!name) return res.redirect(`/admin/tournaments/${tournamentId}`);

    let groupId = undefined;
    if (groupIdRaw && mongoose.isValidObjectId(groupIdRaw)) {
      const g = await Group.findOne({ _id: groupIdRaw, tournamentId });
      if (g) groupId = g._id;
    }

    await Team.create({ tournamentId, groupId, name });
    await syncTeamCodesForTournament(tournamentId);
    res.redirect(`/admin/tournaments/${tournamentId}`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/teams/:teamId/update', requireStaff, async (req, res, next) => {
  try {
    const { teamId } = req.params;
    if (!mongoose.isValidObjectId(teamId)) return res.status(404).send('Not found');
    const team = await Team.findById(teamId);
    if (!team || team.isPlaceholder) return res.status(404).send('Not found');

    const name = String(req.body.name || '').trim();
    if (!name) return res.redirect(`/admin/tournaments/${team.tournamentId}?team_err=empty`);

    const groupIdRaw = String(req.body.groupId || '').trim();
    let groupId = undefined;
    if (groupIdRaw && mongoose.isValidObjectId(groupIdRaw)) {
      const g = await Group.findOne({ _id: groupIdRaw, tournamentId: team.tournamentId });
      if (g) groupId = g._id;
    }

    team.name = name;
    team.groupId = groupId;
    await team.save();
    await syncTeamCodesForTournament(team.tournamentId);
    res.redirect(`/admin/tournaments/${team.tournamentId}?team_saved=1`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/tournaments/:tournamentId/matches', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');
    const t = await Tournament.findById(tournamentId);
    if (!t) return res.status(404).send('Not found');

    const teamA = String(req.body.teamA || '');
    const teamB = String(req.body.teamB || '');
    const mf = String(req.body.matchFormat || 'bestOf3');
    if (![MATCH_FORMAT.BEST_OF_3, MATCH_FORMAT.BEST_OF_5, MATCH_FORMAT.SINGLE_GAME].includes(mf)) {
      return res.redirect(`/admin/tournaments/${tournamentId}`);
    }
    if (!mongoose.isValidObjectId(teamA) || !mongoose.isValidObjectId(teamB) || teamA === teamB) {
      return res.redirect(`/admin/tournaments/${tournamentId}`);
    }

    const [ta, tb] = await Promise.all([
      Team.findOne({ _id: teamA, tournamentId }),
      Team.findOne({ _id: teamB, tournamentId }),
    ]);
    if (!ta || !tb) return res.redirect(`/admin/tournaments/${tournamentId}`);

    let groupId = undefined;
    const gid = String(req.body.groupId || '').trim();
    if (gid && mongoose.isValidObjectId(gid)) {
      const g = await Group.findOne({ _id: gid, tournamentId });
      if (g) groupId = g._id;
    }

    const round = String(req.body.round || '').trim();
    const court = String(req.body.court || '').trim();
    const scheduledTime = normalizeTimeToHHmm(req.body.scheduledTime);

    await Match.create({
      tournamentId,
      groupId,
      round,
      matchFormat: mf,
      teamA: ta._id,
      teamB: tb._id,
      court,
      scheduledTime,
      status: 'scheduled',
      completedGames: [],
      currentGameIndex: 0,
      currentPoints: { a: 0, b: 0 },
    });

    res.redirect(`/admin/tournaments/${tournamentId}`);
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/matches/:matchId/edit', requireStaff, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    if (!mongoose.isValidObjectId(matchId)) return res.status(404).send('Not found');
    const match = await Match.findById(matchId).populate('teamA teamB').lean();
    if (!match) return res.status(404).send('Not found');

    const tournament = await Tournament.findById(match.tournamentId).lean();
    if (!tournament) return res.status(404).send('Not found');
    const event = await Event.findById(tournament.eventId).lean();

    const teams = await Team.find({ tournamentId: tournament._id }).sort({ createdAt: 1 }).lean();
    const refereeUsers = await User.find({ role: 'referee' }).sort({ email: 1 }).lean();
    const assigns = await MatchAssignment.find({ matchId }).populate('refereeId').lean();
    const assignedReferees = assigns.map((a) => a.refereeId).filter(Boolean);

    res.render('pages/admin-match', {
      title: '編輯場次',
      event,
      tournament,
      match,
      teams,
      refereeUsers,
      assignedReferees,
      userEmail: req.session.email,
      scheduledTimeValue: timeInputValueFromMatch(match),
      flash: req.query.saved === '1' ? '已儲存' : null,
      error: null,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/matches/:matchId/update', requireStaff, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    if (!mongoose.isValidObjectId(matchId)) return res.status(404).send('Not found');
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).send('Not found');

    const tournament = await Tournament.findById(match.tournamentId);
    if (!tournament) return res.status(404).send('Not found');

    const teamA = String(req.body.teamA || '');
    const teamB = String(req.body.teamB || '');
    const mf = String(req.body.matchFormat || 'bestOf3');
    if (![MATCH_FORMAT.BEST_OF_3, MATCH_FORMAT.BEST_OF_5, MATCH_FORMAT.SINGLE_GAME].includes(mf)) {
      return res.redirect(`/admin/matches/${matchId}/edit`);
    }
    if (!mongoose.isValidObjectId(teamA) || !mongoose.isValidObjectId(teamB) || teamA === teamB) {
      return res.redirect(`/admin/matches/${matchId}/edit`);
    }

    const [ta, tb] = await Promise.all([
      Team.findOne({ _id: teamA, tournamentId: tournament._id }),
      Team.findOne({ _id: teamB, tournamentId: tournament._id }),
    ]);
    if (!ta || !tb) return res.redirect(`/admin/matches/${matchId}/edit`);

    match.teamA = ta._id;
    match.teamB = tb._id;
    match.matchFormat = mf;
    match.scheduledTime = normalizeTimeToHHmm(req.body.scheduledTime);
    match.scheduledAt = null;
    match.court = String(req.body.court || '').trim();
    match.round = String(req.body.round || '').trim();
    match.status = String(req.body.status || 'scheduled');

    applyManualScoresFromBody(match, req.body);

    if (match.status === 'finished') {
      finalizeFinishedMatch(match);
    } else if (
      (match.completedGames?.length || 0) > 0 ||
      Number(match.currentPoints?.a) > 0 ||
      Number(match.currentPoints?.b) > 0
    ) {
      if (match.status === 'scheduled') match.status = 'live';
    }

    await match.save();
    await broadcastMatchUpdate(req.app, match._id);
    res.redirect(`/admin/matches/${matchId}/edit?saved=1`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/matches/:matchId/assign', requireStaff, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const refereeId = String(req.body.refereeId || '');
    if (!mongoose.isValidObjectId(matchId) || !mongoose.isValidObjectId(refereeId)) {
      return res.status(400).send('Bad request');
    }
    const match = await Match.findById(matchId);
    if (!match) return res.status(404).send('Not found');
    const user = await User.findById(refereeId);
    if (!user || user.role !== 'referee') return res.redirect(`/admin/matches/${matchId}/edit`);

    await MatchAssignment.findOneAndUpdate(
      { matchId, refereeId },
      { matchId, refereeId },
      { upsert: true }
    );
    res.redirect(adminRedirectTarget(req.body.redirect, `/admin/matches/${matchId}/edit`));
  } catch (e) {
    if (e.code === 11000) {
      return res.redirect(adminRedirectTarget(req.body.redirect, `/admin/matches/${req.params.matchId}/edit`));
    }
    next(e);
  }
});

adminRouter.post('/matches/:matchId/unassign', requireStaff, async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const refereeId = String(req.body.refereeId || '');
    if (!mongoose.isValidObjectId(matchId) || !mongoose.isValidObjectId(refereeId)) {
      return res.status(400).send('Bad request');
    }
    await MatchAssignment.deleteOne({ matchId, refereeId });
    res.redirect(adminRedirectTarget(req.body.redirect, `/admin/matches/${matchId}/edit`));
  } catch (e) {
    next(e);
  }
});
