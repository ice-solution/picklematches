import './models/index.js';
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import cors from 'cors';
import methodOverride from 'method-override';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { homeRouter } from './routes/home.js';
import { publicWebRouter } from './routes/publicWeb.js';
import { publicApiRouter } from './routes/publicApi.js';
import { adminRouter } from './routes/admin.js';
import { adminApiRouter } from './routes/adminApi.js';
import { memberRouter } from './routes/member.js';
import { registerWebRouter } from './routes/registerWeb.js';
import { registerApiRouter } from './routes/registerApi.js';
import { paymentWebhookRouter } from './routes/paymentWebhook.js';
import { allianceWebRouter, memberAllianceRouter } from './routes/allianceWeb.js';
import { openSessionWebRouter } from './routes/openSessionWeb.js';
import { playerWebRouter } from './routes/playerWeb.js';
import { courtWebRouter } from './routes/courtWeb.js';
import { courtApiRouter } from './routes/courtApi.js';
import { scoreSummary, scoreDisplayParts, formatLabel, gamesLine, matchStatusLabel, formatTeamWithCode } from './lib/viewHelpers.js';
import { isDeuce } from './lib/scoring.js';
import { displayMatchTime, displayMatchSchedule } from './lib/matchTime.js';
import { formatDateDisplayZh } from './lib/datetime.js';
import { bracketSlotLabel } from './lib/knockoutLadder.js';
import { normalizeEventVenues, venueLabel } from './lib/venues.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

function getCssVersion() {
  try {
    return String(fs.statSync(path.join(rootDir, 'public/css/styles.css')).mtimeMs);
  } catch {
    return '1';
  }
}

export function createApp() {
  const app = express();
  const mongoUrl = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pickleball_tournament';

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  app.set('views', path.join(rootDir, 'views'));
  app.set('view engine', 'ejs');
  app.locals.scoreSummary = scoreSummary;
  app.locals.scoreDisplayParts = scoreDisplayParts;
  app.locals.formatLabel = formatLabel;
  app.locals.gamesLine = gamesLine;
  app.locals.isDeuce = isDeuce;
  app.locals.displayMatchTime = displayMatchTime;
  app.locals.displayMatchSchedule = displayMatchSchedule;
  app.locals.formatDateDisplayZh = formatDateDisplayZh;
  app.locals.matchStatusLabel = matchStatusLabel;
  app.locals.formatTeamWithCode = formatTeamWithCode;
  app.locals.bracketSlotLabel = bracketSlotLabel;
  app.locals.normalizeEventVenues = normalizeEventVenues;
  app.locals.venueLabel = venueLabel;
  app.locals.cssVersion = getCssVersion();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(methodOverride('_method'));
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl }),
      cookie: {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production',
      },
    })
  );

  app.use((req, res, next) => {
    res.locals.session = req.session;
    next();
  });

  app.use('/public', express.static(path.join(rootDir, 'public')));
  app.use('/docs', express.static(path.join(rootDir, 'public', 'docs')));

  app.use('/', homeRouter);
  app.use('/member', memberRouter);
  app.use('/member', memberAllianceRouter);
  app.use('/alliances', allianceWebRouter);
  app.use('/players', playerWebRouter);
  app.use('/sessions', openSessionWebRouter);
  app.use('/e', courtWebRouter);
  app.use('/e', publicWebRouter);
  app.use('/e', registerWebRouter);
  app.use('/api/public', courtApiRouter);
  app.use('/api/public', publicApiRouter);
  app.use('/api/public', registerApiRouter);
  app.use('/webhook', paymentWebhookRouter);
  app.use('/admin', adminRouter);
  app.use('/api/admin', adminApiRouter);

  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.status(404).render('pages/error', { title: '找不到頁面', message: '請檢查網址。' });
  });

  app.use((err, req, res, _next) => {
    console.error(err);
    if (req.path.startsWith('/api')) {
      return res.status(500).json({ error: 'server_error' });
    }
    res.status(500).render('pages/error', { title: '伺服器錯誤', message: '請稍後再試。' });
  });

  return app;
}
