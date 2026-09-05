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
import { requireStaff, requireAllianceReview, requireAdmin } from '../middleware/auth.js';
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
import { generateKnockoutFromGroup, generateKnockoutFromTeams } from '../lib/knockoutGenerator.js';
import { generateGroupRoundRobin } from '../lib/groupScheduleGenerator.js';
import { assignTeamCodeIfEmpty } from '../lib/teamCodes.js';
import { buildGroupRoundRobinMatrices } from '../lib/groupRoundRobinMatrix.js';
import { Division } from '../models/Division.js';
import { Registration } from '../models/Registration.js';
import { Member } from '../models/Member.js';
import { countDivisionRegistrations } from '../lib/registrationEligibility.js';
import {
  promoteRegistrationsToTeams,
  cancelRegistrationAndRemoveTeam,
} from '../lib/registrationTeamService.js';
import { Alliance } from '../models/Alliance.js';
import { approveAlliance, rejectAlliance } from '../lib/allianceService.js';
import { normalizeEventVenues, parseVenuesFromBody, findVenue } from '../lib/venues.js';
import { demoteOtherLiveOnCourt } from '../lib/courtLive.js';
import {
  BACKOFFICE_ROLES,
  canAccessEventDoc,
  eventListFilter,
  findAccessibleMatch,
  findAccessibleTournament,
  forbidAccess,
} from '../lib/eventAccess.js';

export const adminRouter = Router();

function resolveCourtSlug(eventVenues, courtRaw) {
  const raw = String(courtRaw || '').trim();
  if (!raw) return '';
  const v = findVenue(eventVenues, raw);
  return v ? v.slug : raw;
}

adminRouter.use((req, res, next) => {
  res.locals.adminPath = req.originalUrl.split('?')[0];
  res.locals.userRole = req.session?.role || '';
  res.locals.userEmail = req.session?.email || '';
  next();
});

/** owner 只能存取自己的大會；admin/staff 不限 */
adminRouter.param('eventId', async (req, res, next, id) => {
  try {
    if (!mongoose.isValidObjectId(id)) return res.status(404).send('Not found');
    const event = await Event.findById(id);
    if (!event) return res.status(404).send('Not found');
    if (!canAccessEventDoc(req.session, event)) return forbidAccess(req, res);
    req.eventDoc = event;
    next();
  } catch (e) {
    next(e);
  }
});

adminRouter.param('tournamentId', async (req, res, next, id) => {
  try {
    if (!req.session?.userId) return next();
    const tournament = await findAccessibleTournament(req.session, id);
    if (!tournament) {
      if (!mongoose.isValidObjectId(id)) return res.status(404).send('Not found');
      const exists = await Tournament.exists({ _id: id });
      if (!exists) return res.status(404).send('Not found');
      return forbidAccess(req, res);
    }
    req.tournamentDoc = tournament;
    next();
  } catch (e) {
    next(e);
  }
});

adminRouter.param('matchId', async (req, res, next, id) => {
  try {
    if (!req.session?.userId) return next();
    const match = await findAccessibleMatch(req.session, id);
    if (!match) {
      if (!mongoose.isValidObjectId(id)) return res.status(404).send('Not found');
      const exists = await Match.exists({ _id: id });
      if (!exists) return res.status(404).send('Not found');
      return forbidAccess(req, res);
    }
    req.matchDoc = match;
    next();
  } catch (e) {
    next(e);
  }
});

adminRouter.param('teamId', async (req, res, next, id) => {
  try {
    if (!req.session?.userId) return next();
    if (!mongoose.isValidObjectId(id)) return res.status(404).send('Not found');
    const team = await Team.findById(id);
    if (!team) return res.status(404).send('Not found');
    const tournament = await findAccessibleTournament(req.session, team.tournamentId);
    if (!tournament) return forbidAccess(req, res);
    req.teamDoc = team;
    next();
  } catch (e) {
    next(e);
  }
});

adminRouter.param('divisionId', async (req, res, next, id) => {
  try {
    if (!req.session?.userId) return next();
    if (!mongoose.isValidObjectId(id)) return res.status(404).send('Not found');
    const division = await Division.findById(id);
    if (!division) return res.status(404).send('Not found');
    const event = await Event.findById(division.eventId);
    if (!event) return res.status(404).send('Not found');
    if (!canAccessEventDoc(req.session, event)) return forbidAccess(req, res);
    req.divisionDoc = division;
    next();
  } catch (e) {
    next(e);
  }
});

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeSlug(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
}

adminRouter.get('/login', (req, res) => {
  if (req.session?.userId && BACKOFFICE_ROLES.includes(req.session.role)) {
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
  if (!BACKOFFICE_ROLES.includes(user.role)) {
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
    const events = await Event.find(eventListFilter(req.session)).sort({ createdAt: -1 }).lean();
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

adminRouter.get('/alliances', requireAllianceReview, async (req, res, next) => {
  try {
    const status = String(req.query.status || 'pending');
    const filter = status === 'all' ? {} : { status };
    const alliances = await Alliance.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.render('pages/admin-alliances', {
      title: '聯盟審核',
      alliances,
      status,
      userEmail: req.session.email,
      notice: req.query.ok === '1' ? '已更新' : null,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/alliances/:allianceId/approve', requireAllianceReview, async (req, res, next) => {
  try {
    await approveAlliance(req.params.allianceId, req.session.userId);
    res.redirect('/admin/alliances?status=pending&ok=1');
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/alliances/:allianceId/reject', requireAllianceReview, async (req, res, next) => {
  try {
    await rejectAlliance(req.params.allianceId, req.session.userId, req.body.reason);
    res.redirect('/admin/alliances?status=pending&ok=1');
  } catch (e) {
    next(e);
  }
});

const MANAGEABLE_ROLES = ['admin', 'staff', 'owner'];

function roleLabelZh(role) {
  if (role === 'admin') return '管理員';
  if (role === 'staff') return '職員';
  if (role === 'owner') return '主辦（owner）';
  if (role === 'referee') return '球證';
  return role;
}

adminRouter.get('/users', requireAdmin, async (req, res, next) => {
  try {
    const users = await User.find({ role: { $in: MANAGEABLE_ROLES } })
      .select('email name role createdAt')
      .sort({ role: 1, createdAt: 1 })
      .lean();
    let flash = null;
    let error = null;
    if (req.query.created === '1') flash = '已建立帳號';
    if (req.query.saved === '1') flash = '已儲存';
    if (req.query.deleted === '1') flash = '已刪除帳號';
    if (req.query.error === 'email') error = '請填寫有效電子郵件';
    if (req.query.error === 'password') error = '密碼至少 6 個字元';
    if (req.query.error === 'role') error = '角色無效';
    if (req.query.error === 'taken') error = '此電子郵件已被使用';
    if (req.query.error === 'self') error = '不能刪除或降級自己的管理員帳號';
    if (req.query.error === 'last_admin') error = '必須至少保留一位管理員';
    if (req.query.error === 'not_found') error = '找不到帳號';

    res.render('pages/admin-users', {
      title: '帳號與權限',
      users,
      roleLabelZh,
      manageableRoles: MANAGEABLE_ROLES,
      currentUserId: req.session.userId,
      userEmail: req.session.email,
      flash,
      error,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/users', requireAdmin, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const name = String(req.body.name || '').trim();
    const password = String(req.body.password || '');
    const role = String(req.body.role || '').trim();

    if (!email || !email.includes('@')) {
      return res.redirect('/admin/users?error=email');
    }
    if (password.length < 6) {
      return res.redirect('/admin/users?error=password');
    }
    if (!MANAGEABLE_ROLES.includes(role)) {
      return res.redirect('/admin/users?error=role');
    }
    const exists = await User.findOne({ email }).select('_id').lean();
    if (exists) {
      return res.redirect('/admin/users?error=taken');
    }

    await User.create({
      email,
      name,
      role,
      passwordHash: await bcrypt.hash(password, 10),
    });
    res.redirect('/admin/users?created=1');
  } catch (e) {
    if (e.code === 11000) return res.redirect('/admin/users?error=taken');
    next(e);
  }
});

adminRouter.post('/users/:userId/update', requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) return res.redirect('/admin/users?error=not_found');

    const user = await User.findById(userId);
    if (!user || !MANAGEABLE_ROLES.includes(user.role)) {
      return res.redirect('/admin/users?error=not_found');
    }

    const name = String(req.body.name || '').trim();
    const role = String(req.body.role || '').trim();
    const password = String(req.body.password || '');

    if (!MANAGEABLE_ROLES.includes(role)) {
      return res.redirect('/admin/users?error=role');
    }

    const isSelf = String(user._id) === String(req.session.userId);
    if (isSelf && role !== 'admin') {
      return res.redirect('/admin/users?error=self');
    }

    if (user.role === 'admin' && role !== 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.redirect('/admin/users?error=last_admin');
      }
    }

    user.name = name;
    user.role = role;
    if (password) {
      if (password.length < 6) return res.redirect('/admin/users?error=password');
      user.passwordHash = await bcrypt.hash(password, 10);
    }
    await user.save();

    if (isSelf) {
      req.session.role = user.role;
    }

    res.redirect('/admin/users?saved=1');
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/users/:userId/delete', requireAdmin, async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) return res.redirect('/admin/users?error=not_found');
    if (String(userId) === String(req.session.userId)) {
      return res.redirect('/admin/users?error=self');
    }

    const user = await User.findById(userId);
    if (!user || !MANAGEABLE_ROLES.includes(user.role)) {
      return res.redirect('/admin/users?error=not_found');
    }

    if (user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.redirect('/admin/users?error=last_admin');
      }
    }

    await User.deleteOne({ _id: user._id });
    res.redirect('/admin/users?deleted=1');
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
    let venues;
    try {
      venues = await parseVenuesFromBody(req.body, []);
    } catch (ve) {
      if (ve.message === 'invalid_venue_slug' || ve.message === 'duplicate_venue_slug') {
        return res.status(400).render('pages/admin-event-new', {
          title: '新增大會',
          userEmail: req.session.email,
          error: '場地 ID 無效或重複（僅限小寫英文、數字、連字號）',
        });
      }
      throw ve;
    }
    const dateStart = parseDatetimeLocal(req.body.dateStart);
    const dateEnd = parseDatetimeLocal(req.body.dateEnd);
    const event = await Event.create({
      name,
      slug,
      venues,
      dateStart,
      dateEnd,
      isActive: true,
      ownerId: req.session.userId,
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
    if (req.query.error === 'venue') error = '場地 ID 無效或重複（僅限小寫英文、數字、連字號）';

    let flash = null;
    if (req.query.saved === '1') flash = '已儲存';
    if (req.query.deleted === '1') flash = '已刪除賽事';

    let tournamentImportReport = null;
    if (req.session.tournamentImportReport) {
      tournamentImportReport = req.session.tournamentImportReport;
      delete req.session.tournamentImportReport;
    }

    const venues = normalizeEventVenues(event.venues);

    res.render('pages/admin-event', {
      title: `設定 — ${event.name}`,
      event: { ...event, venues },
      venues,
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
    try {
      doc.venues = await parseVenuesFromBody(req.body, doc.venues);
    } catch (ve) {
      if (ve.message === 'invalid_venue_slug' || ve.message === 'duplicate_venue_slug') {
        return res.redirect(`/admin/events/${eventId}?error=venue`);
      }
      throw ve;
    }
    doc.markModified('venues');
    doc.description = String(req.body.description || '').trim();
    doc.coverImageUrl = String(req.body.coverImageUrl || '').trim();
    doc.isActive = req.body.isActive === '1';
    await doc.save();
    res.redirect(`/admin/events/${eventId}?saved=1`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/events/:eventId/registration', requireStaff, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) return res.status(404).send('Not found');
    const doc = await Event.findById(eventId);
    if (!doc) return res.status(404).send('Not found');

    doc.registrationEnabled = req.body.registrationEnabled === '1';
    doc.registrationInfo = String(req.body.registrationInfo || '').trim();
    doc.venueDetails = String(req.body.venueDetails || '').trim();
    doc.eligibilityNotes = String(req.body.eligibilityNotes || '').trim();
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

    const knockoutLadderColumns =
      tournament.phase === 'knockout' ? buildKnockoutLadderColumns(matches) : [];

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

    const groupRoundRobinMatrices =
      tournament.phase === 'group'
        ? buildGroupRoundRobinMatrices({ groups, teams, matches })
        : [];

    const venues = normalizeEventVenues(event.venues);

    res.render('pages/admin-tournament', {
      title: `${tournament.name} — 賽程`,
      event: { ...event, venues },
      venues,
      tournament,
      groupTournaments,
      groups,
      teams,
      matches,
      userEmail: req.session.email,
      flash: req.query.saved === '1' ? '已儲存' : null,
      error: null,
      importReport,
      teamImportReport,
      knockoutLadderColumns,
      groupRoundRobinMatrices,
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
    if (sourceTournamentId) {
      const src = await findAccessibleTournament(req.session, sourceTournamentId);
      if (!src) return forbidAccess(req, res);
    }
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

/** 純淘汰賽：由本賽事隊伍直接產生鬼腳籤表 */
adminRouter.post('/tournaments/:tournamentId/generate-knockout-bracket', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');

    const force = req.body.force === '1' || req.body.force === 'true';
    if (force) {
      const t = await Tournament.findById(tournamentId).lean();
      if (!t || t.phase !== 'knockout') {
        return res.redirect(`/admin/tournaments/${tournamentId}`);
      }
      const matches = await Match.find({ tournamentId }).select('_id').lean();
      const matchIds = matches.map((m) => m._id);
      if (matchIds.length) {
        await MatchAssignment.deleteMany({ matchId: { $in: matchIds } });
        await Match.deleteMany({ _id: { $in: matchIds } });
      }
      await Team.deleteMany({
        tournamentId,
        $or: [{ isPlaceholder: true }, { sourceTeamId: { $exists: true, $ne: null } }],
      });
    }

    const r = await generateKnockoutFromTeams({
      knockoutTournamentId: tournamentId,
      matchFormat: req.body.matchFormat,
      courts: undefined,
    });
    if (!r.ok) {
      const code = r.error || 'error';
      return res.redirect(`/admin/tournaments/${tournamentId}?gen=${encodeURIComponent(code)}`);
    }
    const qs = [`gen=ok`, `teams=${r.createdTeams}`];
    if (r.createdMatches) qs.push(`matches=${r.createdMatches}`);
    if (r.matchFormat) qs.push(`fmt=${encodeURIComponent(r.matchFormat)}`);
    if (r.courtsUsed != null) qs.push(`courts=${r.courtsUsed}`);
    res.redirect(`/admin/tournaments/${tournamentId}?${qs.join('&')}`);
  } catch (e) {
    next(e);
  }
});

/** 小組賽：各組單循環一鍵產生賽程 */
adminRouter.post('/tournaments/:tournamentId/generate-group-schedule', requireStaff, async (req, res, next) => {
  try {
    const { tournamentId } = req.params;
    if (!mongoose.isValidObjectId(tournamentId)) return res.status(404).send('Not found');

    const force = req.body.force === '1' || req.body.force === 'true';
    if (force) {
      const t = await Tournament.findById(tournamentId).lean();
      if (!t || t.phase !== 'group') {
        return res.redirect(`/admin/tournaments/${tournamentId}`);
      }
      const matches = await Match.find({ tournamentId }).select('_id').lean();
      const matchIds = matches.map((m) => m._id);
      if (matchIds.length) {
        await MatchAssignment.deleteMany({ matchId: { $in: matchIds } });
        await Match.deleteMany({ _id: { $in: matchIds } });
      }
    }

    const r = await generateGroupRoundRobin({
      tournamentId,
      matchFormat: req.body.matchFormat,
    });
    if (!r.ok) {
      const code = r.error || 'error';
      return res.redirect(`/admin/tournaments/${tournamentId}?gen=${encodeURIComponent(code)}`);
    }
    const qs = [`gen=ok`, `teams=${r.createdTeams}`, `groups=${r.groupsUsed}`, `rounds=${r.rounds}`];
    if (r.createdMatches) qs.push(`matches=${r.createdMatches}`);
    if (r.matchFormat) qs.push(`fmt=${encodeURIComponent(r.matchFormat)}`);
    if (r.courtsUsed != null) qs.push(`courts=${r.courtsUsed}`);
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

    const doc = await Team.create({ tournamentId, groupId, name });
    await assignTeamCodeIfEmpty(doc);
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

    const code = String(req.body.code ?? '').trim().toUpperCase();
    if (code) {
      const dup = await Team.findOne({
        tournamentId: team.tournamentId,
        _id: { $ne: team._id },
        code,
        isPlaceholder: { $ne: true },
      }).lean();
      if (dup) {
        return res.redirect(`/admin/tournaments/${team.tournamentId}?team_err=code_dup`);
      }
    }

    const groupIdRaw = String(req.body.groupId || '').trim();
    let groupId = undefined;
    if (groupIdRaw && mongoose.isValidObjectId(groupIdRaw)) {
      const g = await Group.findOne({ _id: groupIdRaw, tournamentId: team.tournamentId });
      if (g) groupId = g._id;
    }

    team.name = name;
    team.code = code;
    team.groupId = groupId;
    await team.save();
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
    const event = await Event.findById(t.eventId).select('venues').lean();
    const court = resolveCourtSlug(event?.venues, req.body.court);
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
    const venues = normalizeEventVenues(event?.venues);

    res.render('pages/admin-match', {
      title: '編輯場次',
      event: event ? { ...event, venues } : null,
      venues,
      tournament,
      match,
      teams,
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
    const eventDoc = await Event.findById(tournament.eventId).select('venues').lean();
    match.court = resolveCourtSlug(eventDoc?.venues, req.body.court);
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
    if (match.status === 'live') {
      try {
        await demoteOtherLiveOnCourt(match);
      } catch (err) {
        console.error('demoteOtherLiveOnCourt failed:', err);
      }
    }
    await broadcastMatchUpdate(req.app, match._id);
    res.redirect(`/admin/matches/${matchId}/edit?saved=1`);
  } catch (e) {
    next(e);
  }
});

async function resolveLinkedTournamentId(eventId, raw, excludeDivisionId = null) {
  const tid = String(raw || '').trim();
  if (!tid) return { ok: true, value: undefined };
  if (!mongoose.isValidObjectId(tid)) return { ok: false, error: 'tournament_invalid' };
  const t = await Tournament.findOne({ _id: tid, eventId }).lean();
  if (!t) return { ok: false, error: 'tournament_invalid' };
  const clashQuery = { linkedTournamentId: t._id };
  if (excludeDivisionId) clashQuery._id = { $ne: excludeDivisionId };
  const clash = await Division.findOne(clashQuery).lean();
  if (clash) return { ok: false, error: 'tournament_taken' };
  return { ok: true, value: t._id };
}

adminRouter.get('/events/:eventId/divisions', requireStaff, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) return res.status(404).send('Not found');
    const event = await Event.findById(eventId).lean();
    if (!event) return res.status(404).send('Not found');
    const divisions = await Division.find({ eventId: event._id }).sort({ order: 1, createdAt: 1 }).lean();
    const tournaments = await Tournament.find({ eventId: event._id }).sort({ order: 1, createdAt: 1 }).lean();
    const counts = await Promise.all(
      divisions.map((d) => countDivisionRegistrations(d._id).then((n) => [String(d._id), n]))
    );
    const countByDiv = Object.fromEntries(counts);

    const errorMap = {
      '1': '請填寫組別名稱',
      tournament_taken: '該賽事已綁定其他報名組別（一對一）',
      tournament_invalid: '連結賽事不屬於此大會',
    };

    res.render('pages/admin-event-divisions', {
      title: `報名組別 — ${event.name}`,
      event,
      tournaments,
      divisions: divisions.map((d) => ({
        ...d,
        registeredCount: countByDiv[String(d._id)] || 0,
        registrationOpenLocal: toDatetimeLocalValue(d.registrationOpen),
        registrationCloseLocal: toDatetimeLocalValue(d.registrationClose),
        linkedTournamentId: d.linkedTournamentId ? String(d.linkedTournamentId) : '',
      })),
      userEmail: req.session.email,
      flash:
        req.query.saved === '1'
          ? '已儲存'
          : req.query.created === '1'
            ? '已新增組別'
            : req.query.deleted === '1'
              ? '已刪除'
              : null,
      error: errorMap[String(req.query.error || '')] || null,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/events/:eventId/divisions', requireStaff, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) return res.status(404).send('Not found');
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).send('Not found');

    const name = String(req.body.name || '').trim();
    if (!name) return res.redirect(`/admin/events/${eventId}/divisions?error=1`);

    const link = await resolveLinkedTournamentId(event._id, req.body.linkedTournamentId);
    if (!link.ok) return res.redirect(`/admin/events/${eventId}/divisions?error=${link.error}`);

    const maxOrder = await Division.findOne({ eventId: event._id }).sort({ order: -1 }).select('order').lean();
    const orderRaw = req.body.order;
    const order =
      orderRaw !== undefined && String(orderRaw).trim() !== ''
        ? Number(orderRaw) || 0
        : (maxOrder?.order ?? -1) + 1;

    await Division.create({
      eventId: event._id,
      name,
      format: req.body.format === 'singles' ? 'singles' : 'doubles',
      fee: Math.max(0, Number(req.body.fee) || 0),
      maxTeams: Math.max(1, Number(req.body.maxTeams) || 32),
      registrationOpen: parseDatetimeLocal(req.body.registrationOpen) || undefined,
      registrationClose: parseDatetimeLocal(req.body.registrationClose) || undefined,
      isPublished: req.body.isPublished === '1',
      order,
      linkedTournamentId: link.value,
      restrictions: {
        gender: ['male', 'female', 'mixed', 'open', ''].includes(req.body.gender) ? req.body.gender : 'open',
        minAge: req.body.minAge ? Number(req.body.minAge) : undefined,
        maxAge: req.body.maxAge ? Number(req.body.maxAge) : undefined,
        minDupr: req.body.minDupr ? Number(req.body.minDupr) : undefined,
        maxDupr: req.body.maxDupr ? Number(req.body.maxDupr) : undefined,
      },
      eligibilityNotes: String(req.body.eligibilityNotes || '').trim(),
    });

    res.redirect(`/admin/events/${eventId}/divisions?created=1`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/divisions/:divisionId/update', requireStaff, async (req, res, next) => {
  try {
    const { divisionId } = req.params;
    if (!mongoose.isValidObjectId(divisionId)) return res.status(404).send('Not found');
    const div = await Division.findById(divisionId);
    if (!div) return res.status(404).send('Not found');

    const name = String(req.body.name || '').trim();
    if (!name) return res.redirect(`/admin/events/${div.eventId}/divisions?error=1`);

    const link = await resolveLinkedTournamentId(div.eventId, req.body.linkedTournamentId, div._id);
    if (!link.ok) return res.redirect(`/admin/events/${div.eventId}/divisions?error=${link.error}`);

    div.name = name;
    div.description = String(req.body.description || '').trim();
    div.format = req.body.format === 'singles' ? 'singles' : 'doubles';
    div.fee = Math.max(0, Number(req.body.fee) || 0);
    div.maxTeams = Math.max(1, Number(req.body.maxTeams) || 32);
    div.registrationOpen = parseDatetimeLocal(req.body.registrationOpen) || undefined;
    div.registrationClose = parseDatetimeLocal(req.body.registrationClose) || undefined;
    div.isPublished = req.body.isPublished === '1';
    div.order = Number(req.body.order) || 0;
    if (link.value) div.linkedTournamentId = link.value;
    else div.linkedTournamentId = undefined;
    div.restrictions = {
      gender: ['male', 'female', 'mixed', 'open', ''].includes(req.body.gender) ? req.body.gender : 'open',
      minAge: req.body.minAge ? Number(req.body.minAge) : undefined,
      maxAge: req.body.maxAge ? Number(req.body.maxAge) : undefined,
      minDupr: req.body.minDupr ? Number(req.body.minDupr) : undefined,
      maxDupr: req.body.maxDupr ? Number(req.body.maxDupr) : undefined,
    };
    div.eligibilityNotes = String(req.body.eligibilityNotes || '').trim();
    await div.save();
    if (!link.value) {
      await Division.updateOne({ _id: div._id }, { $unset: { linkedTournamentId: 1 } });
    }

    res.redirect(`/admin/events/${div.eventId}/divisions?saved=1`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/divisions/:divisionId/delete', requireStaff, async (req, res, next) => {
  try {
    const { divisionId } = req.params;
    if (!mongoose.isValidObjectId(divisionId)) return res.status(404).send('Not found');
    const div = await Division.findById(divisionId);
    if (!div) return res.status(404).send('Not found');
    const eventId = div.eventId;
    await Division.deleteOne({ _id: divisionId });
    res.redirect(`/admin/events/${eventId}/divisions?deleted=1`);
  } catch (e) {
    next(e);
  }
});

adminRouter.get('/events/:eventId/registrations', requireStaff, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) return res.status(404).send('Not found');
    const event = await Event.findById(eventId).lean();
    if (!event) return res.status(404).send('Not found');

    const divisions = await Division.find({ eventId: event._id }).sort({ order: 1 }).lean();
    const tournaments = await Tournament.find({ eventId: event._id }).sort({ order: 1, createdAt: 1 }).lean();
    const tName = Object.fromEntries(tournaments.map((t) => [String(t._id), t.name]));
    const divFilter = String(req.query.division || '').trim();
    const query = { eventId: event._id };
    if (mongoose.isValidObjectId(divFilter)) query.divisionId = divFilter;

    const registrations = await Registration.find(query)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    const memberIds = [...new Set(registrations.flatMap((r) => (r.memberIds || []).map(String)))];
    const members = await Member.find({ _id: { $in: memberIds } }).lean();
    const memberMap = Object.fromEntries(members.map((m) => [String(m._id), m]));
    const divMap = Object.fromEntries(
      divisions.map((d) => [
        String(d._id),
        {
          ...d,
          linkedTournamentName: d.linkedTournamentId ? tName[String(d.linkedTournamentId)] || null : null,
        },
      ])
    );

    const summary = await Promise.all(
      divisions.map(async (d) => {
        const paid = await Registration.countDocuments({
          divisionId: d._id,
          status: { $in: ['paid', 'confirmed'] },
        });
        const pending = await Registration.countDocuments({ divisionId: d._id, status: 'pending_payment' });
        const confirmed = await Registration.countDocuments({ divisionId: d._id, status: 'confirmed' });
        return { division: divMap[String(d._id)], paid, pending, confirmed, total: paid + pending };
      })
    );

    const flash =
      req.query.promoted
        ? `已移入 ${req.query.promoted} 隊`
        : req.query.cancelled === '1'
          ? '已取消報名並移走隊伍（不可還原）。請另行處理退款（可能扣除手續費）。'
          : null;
    const warning =
      req.query.schedule_warn === '1'
        ? '注意：該賽事已有場次。新增隊伍後請重新安排賽程。'
        : null;
    const errorMap = {
      none_selected: '請先勾選要移入的報名',
      none_eligible: '沒有可移入的報名（須已付款且尚未移入）',
      promote_failed: '移入失敗，請檢查組別是否已綁定賽事及名額',
      not_found: '找不到報名紀錄',
      already_cancelled: '此報名已取消',
      cannot_cancel_status: '此狀態不可取消',
      team_in_matches: '該隊伍已出現在場次中，請先從賽程移除後再取消',
    };

    res.render('pages/admin-event-registrations', {
      title: `報名紀錄 — ${event.name}`,
      event,
      divisions: Object.values(divMap),
      divFilter,
      summary,
      flash,
      warning,
      error: errorMap[String(req.query.error || '')] || null,
      promoteDetails: req.query.details ? String(req.query.details).split('|').filter(Boolean) : [],
      registrations: registrations.map((r) => ({
        ...r,
        division: divMap[String(r.divisionId)],
        members: (r.memberIds || []).map((id) => memberMap[String(id)]).filter(Boolean),
        canPromote: r.status === 'paid' && !r.teamId,
        canCancel: ['paid', 'confirmed'].includes(r.status),
      })),
      userEmail: req.session.email,
    });
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/events/:eventId/registrations/promote', requireStaff, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!mongoose.isValidObjectId(eventId)) return res.status(404).send('Not found');
    const event = await Event.findById(eventId).lean();
    if (!event) return res.status(404).send('Not found');

    const raw = req.body.ids;
    const ids = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const result = await promoteRegistrationsToTeams(ids, { eventId: event._id });

    const q = new URLSearchParams();
    if (req.body.division) q.set('division', String(req.body.division));
    if (result.ok) {
      q.set('promoted', String(result.promoted));
      if (result.scheduleWarning) q.set('schedule_warn', '1');
      if (result.details?.length) q.set('details', result.details.slice(0, 8).join('|'));
    } else {
      q.set('error', result.error || 'promote_failed');
      if (result.details?.length) q.set('details', result.details.slice(0, 8).join('|'));
    }
    res.redirect(`/admin/events/${eventId}/registrations?${q.toString()}`);
  } catch (e) {
    next(e);
  }
});

adminRouter.post('/events/:eventId/registrations/:registrationId/cancel', requireStaff, async (req, res, next) => {
  try {
    const { eventId, registrationId } = req.params;
    if (!mongoose.isValidObjectId(eventId) || !mongoose.isValidObjectId(registrationId)) {
      return res.status(404).send('Not found');
    }
    const event = await Event.findById(eventId).lean();
    if (!event) return res.status(404).send('Not found');

    const result = await cancelRegistrationAndRemoveTeam(registrationId, { eventId: event._id });
    const q = new URLSearchParams();
    if (req.body.division) q.set('division', String(req.body.division));
    if (result.ok) q.set('cancelled', '1');
    else q.set('error', result.error || 'not_found');
    res.redirect(`/admin/events/${eventId}/registrations?${q.toString()}`);
  } catch (e) {
    next(e);
  }
});
