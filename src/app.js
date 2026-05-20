import './models/index.js';
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import cors from 'cors';
import methodOverride from 'method-override';
import path from 'path';
import { fileURLToPath } from 'url';

import { homeRouter } from './routes/home.js';
import { publicWebRouter } from './routes/publicWeb.js';
import { publicApiRouter } from './routes/publicApi.js';
import { adminRouter } from './routes/admin.js';
import { refereeRouter } from './routes/referee.js';
import { refereeApiRouter } from './routes/refereeApi.js';
import { adminApiRouter } from './routes/adminApi.js';
import { scoreboardApiRouter } from './routes/scoreboardApi.js';
import { scoreSummary, formatLabel, gamesLine } from './lib/viewHelpers.js';
import { isDeuce } from './lib/scoring.js';
import { displayMatchTime } from './lib/matchTime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

export function createApp() {
  const app = express();
  const mongoUrl = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pickleball_tournament';

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  app.set('views', path.join(rootDir, 'views'));
  app.set('view engine', 'ejs');
  app.locals.scoreSummary = scoreSummary;
  app.locals.formatLabel = formatLabel;
  app.locals.gamesLine = gamesLine;
  app.locals.isDeuce = isDeuce;
  app.locals.displayMatchTime = displayMatchTime;

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

  app.use('/public', express.static(path.join(rootDir, 'public')));
  app.use('/docs', express.static(path.join(rootDir, 'public', 'docs')));

  app.use('/', homeRouter);
  app.use('/e', publicWebRouter);
  app.use('/api/public', publicApiRouter);
  app.use('/admin', adminRouter);
  app.use('/referee', refereeRouter);
  app.use('/api/referee', refereeApiRouter);
  app.use('/api/admin', adminApiRouter);
  app.use('/api/admin', scoreboardApiRouter);

  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'not_found' });
    }
    res.status(404).render('pages/error', { title: '找不到頁面', message: '請檢查網址。' });
  });

  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).render('pages/error', { title: '伺服器錯誤', message: '請稍後再試。' });
  });

  return app;
}
