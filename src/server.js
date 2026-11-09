import 'dotenv/config';
import './models/index.js';
import http from 'http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { ensureDefaultAdmin } from './lib/ensureDefaultAdmin.js';

const port = Number(process.env.PORT) || 3000;
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pickleball_tournament';

await connectDb(mongoUri);
await ensureDefaultAdmin();

const app = createApp();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
  // 大螢幕／裁判機長開：較密 ping，斷線快啲發現並重連
  pingInterval: 10000,
  pingTimeout: 20000,
  connectTimeout: 20000,
});
app.set('io', io);

io.on('connection', (socket) => {
  const joinRooms = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.eventId) socket.join(`event:${payload.eventId}`);
    if (payload.matchId) socket.join(`match:${payload.matchId}`);
    if (payload.court?.eventId && payload.court?.venueSlug) {
      socket.join(`court:${payload.court.eventId}:${payload.court.venueSlug}`);
    }
  };

  socket.on('join', joinRooms);
  // 相容舊客戶端；重連後客戶端會再 emit join
  socket.on('court:subscribe', joinRooms);
});

httpServer.listen(port, () => {
  console.log(`伺服器啟動: http://localhost:${port}`);
});
