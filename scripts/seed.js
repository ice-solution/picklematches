import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDb } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Event } from '../src/models/Event.js';
import { Tournament } from '../src/models/Tournament.js';
import { Group } from '../src/models/Group.js';
import { Team } from '../src/models/Team.js';
import { Match, MATCH_FORMAT } from '../src/models/Match.js';
import { MatchAssignment } from '../src/models/MatchAssignment.js';

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pickleball_tournament';

async function hash(pw) {
  return bcrypt.hash(pw, 10);
}

async function run() {
  await connectDb(mongoUri);
  const pass = 'Demo1234';

  const adminHash = await hash(pass);
  await User.findOneAndUpdate(
    { email: 'admin@demo.local' },
    { $set: { passwordHash: adminHash, role: 'admin', name: '示範管理員' } },
    { upsert: true }
  );
  await User.findOneAndUpdate(
    { email: 'referee@demo.local' },
    { $set: { passwordHash: adminHash, role: 'referee', name: '示範球證', loginId: 'referee1' } },
    { upsert: true }
  );

  const referee = await User.findOne({ email: 'referee@demo.local' });

  let event = await Event.findOne({ slug: 'demo-2026' });
  if (!event) {
    event = await Event.create({
      name: '示範大會 2026',
      slug: 'demo-2026',
      description: '由 npm run seed 建立',
      isActive: true,
    });
  }

  let tournament = await Tournament.findOne({ eventId: event._id, name: '公開組 — 小組賽' });
  if (!tournament) {
    tournament = await Tournament.create({
      eventId: event._id,
      name: '公開組 — 小組賽',
      phase: 'group',
      advancePerGroup: 2,
      order: 0,
    });
  }

  let group = await Group.findOne({ tournamentId: tournament._id, name: 'A 組' });
  if (!group) {
    group = await Group.create({ tournamentId: tournament._id, name: 'A 組', order: 0 });
  }

  let teamA = await Team.findOne({ tournamentId: tournament._id, name: '紅隊' });
  if (!teamA) {
    teamA = await Team.create({ tournamentId: tournament._id, groupId: group._id, name: '紅隊' });
  }
  let teamB = await Team.findOne({ tournamentId: tournament._id, name: '藍隊' });
  if (!teamB) {
    teamB = await Team.create({ tournamentId: tournament._id, groupId: group._id, name: '藍隊' });
  }

  let match = await Match.findOne({ tournamentId: tournament._id, teamA: teamA._id, teamB: teamB._id });
  if (!match) {
    match = await Match.create({
      tournamentId: tournament._id,
      groupId: group._id,
      round: 'A 組',
      matchFormat: MATCH_FORMAT.SINGLE_GAME,
      teamA: teamA._id,
      teamB: teamB._id,
      court: '1 號場',
      scheduledTime: '10:00',
      status: 'scheduled',
      completedGames: [],
      currentGameIndex: 0,
      currentPoints: { a: 0, b: 0 },
    });
  }

  const existingAssign = await MatchAssignment.findOne({ matchId: match._id, refereeId: referee._id });
  if (!existingAssign) {
    await MatchAssignment.create({ matchId: match._id, refereeId: referee._id });
  }

  console.log('Seed 完成。');
  console.log('管理員: admin@demo.local / Demo1234');
  console.log('球證:   登入 ID referee1 / Demo1234（信箱 referee@demo.local）');
  console.log('前台:   http://localhost:3000/e/demo-2026');
  console.log('大螢幕: http://localhost:3000/e/demo-2026/screen/' + match._id.toString());

  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
