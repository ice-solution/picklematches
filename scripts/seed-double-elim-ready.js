/**
 * 建立「隊伍已齊、未產生籤表」雙敗練習大會。
 * 方便測試：入齊隊伍後再自己按「產生雙敗淘汰籤表」、填分、推進。
 *
 * 用法：node scripts/seed-double-elim-ready.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { Event } from '../src/models/Event.js';
import { Tournament } from '../src/models/Tournament.js';
import { Team } from '../src/models/Team.js';
import { Match } from '../src/models/Match.js';
import { MatchAssignment } from '../src/models/MatchAssignment.js';
import { Group } from '../src/models/Group.js';

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pickleball_tournament';
const EVENT_SLUG = 'de-ready-2026';
const TOURNAMENT_NAME = '雙敗練習組（8隊已齊）';
const TEAM_NAMES = ['紅隊', '橙隊', '黃隊', '綠隊', '青隊', '藍隊', '紫隊', '黑隊'];

async function run() {
  await connectDb(mongoUri);

  let event = await Event.findOne({ slug: EVENT_SLUG });
  if (!event) {
    event = await Event.create({
      name: '雙敗操作練習',
      slug: EVENT_SLUG,
      description: '隊伍已齊，尚未產生籤表。請到賽事頁按「產生雙敗淘汰籤表」。',
      isActive: true,
      venues: [
        { slug: 'c1', name: '1號場', pinHash: '' },
        { slug: 'c2', name: '2號場', pinHash: '' },
      ],
    });
  }

  let tournament = await Tournament.findOne({ eventId: event._id, name: TOURNAMENT_NAME });
  if (tournament) {
    const matches = await Match.find({ tournamentId: tournament._id }).select('_id').lean();
    const matchIds = matches.map((m) => m._id);
    if (matchIds.length) {
      await MatchAssignment.deleteMany({ matchId: { $in: matchIds } });
      await Match.deleteMany({ _id: { $in: matchIds } });
    }
    await Team.deleteMany({ tournamentId: tournament._id });
    await Group.deleteMany({ tournamentId: tournament._id });
  } else {
    tournament = await Tournament.create({
      eventId: event._id,
      name: TOURNAMENT_NAME,
      phase: 'double_elim',
      order: 0,
      competitionDate: '2026-09-20',
    });
  }

  tournament.phase = 'double_elim';
  tournament.competitionDate = '2026-09-20';
  await tournament.save();

  for (let i = 0; i < TEAM_NAMES.length; i++) {
    await Team.create({
      tournamentId: tournament._id,
      name: TEAM_NAMES[i],
      code: `T${i + 1}`,
      seed: i + 1,
    });
  }

  const port = process.env.PORT || 5239;
  console.log('已準備練習大會（8 隊已齊、未產生籤表）');
  console.log('  後台大會:', `http://localhost:${port}/admin/events/${event._id}`);
  console.log('  後台賽事:', `http://localhost:${port}/admin/tournaments/${tournament._id}`);
  console.log('  前台:', `http://localhost:${port}/e/${EVENT_SLUG}`);
  console.log('下一步：進入賽事 → 產生雙敗淘汰籤表（建議選一局過）');

  await mongoose.disconnect();
}

run().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
