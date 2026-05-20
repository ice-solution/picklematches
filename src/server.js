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
});
app.set('io', io);

io.on('connection', (socket) => {
  socket.on('join', (payload) => {
    if (payload?.eventId) socket.join(`event:${payload.eventId}`);
    if (payload?.matchId) socket.join(`match:${payload.matchId}`);
    if (payload?.scoreboardEventId) socket.join(`scoreboard:${payload.scoreboardEventId}`);
  });
});

httpServer.listen(port, () => {
  console.log(`伺服器啟動: http://localhost:${port}`);
});
