/**
 * 為大會下所有小組賽賽事重編隊伍代號
 * 用法：node scripts/sync-event-team-codes.js <event-slug>
 */
import '../src/models/index.js';
import mongoose from 'mongoose';
import { Event } from '../src/models/Event.js';
import { Tournament } from '../src/models/Tournament.js';
import { syncTeamCodesForTournament } from '../src/lib/teamCodes.js';

const slug = process.argv[2];
if (!slug) {
  console.error('用法: node scripts/sync-event-team-codes.js <event-slug>');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pickleball_tournament');

const event = await Event.findOne({
  $or: [{ slug: slug.toLowerCase() }, { slugAliases: slug.toLowerCase() }],
});
if (!event) {
  console.error('找不到大會:', slug);
  process.exit(1);
}

const tournaments = await Tournament.find({ eventId: event._id, phase: 'group' }).lean();
for (const t of tournaments) {
  await syncTeamCodesForTournament(t._id, { onlyIfEmpty: false });
  console.log('已同步:', t.name);
}

console.log('完成', tournaments.length, '個小組賽');
await mongoose.disconnect();
