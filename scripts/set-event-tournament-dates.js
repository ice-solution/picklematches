/**
 * 批次設定大會下所有賽事的比賽日期
 * 用法：node scripts/set-event-tournament-dates.js <event-slug> <YYYY-MM-DD>
 */
import '../src/models/index.js';
import mongoose from 'mongoose';
import { Event } from '../src/models/Event.js';
import { Tournament } from '../src/models/Tournament.js';
import { normalizeDateOnly } from '../src/lib/datetime.js';

const slug = process.argv[2];
const date = normalizeDateOnly(process.argv[3]);

if (!slug || !date) {
  console.error('用法: node scripts/set-event-tournament-dates.js <event-slug> <YYYY-MM-DD>');
  process.exit(1);
}

const mongoUrl = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pickleball_tournament';
await mongoose.connect(mongoUrl);

const event = await Event.findOne({
  $or: [{ slug: slug.toLowerCase() }, { slugAliases: slug.toLowerCase() }],
});
if (!event) {
  console.error('找不到大會:', slug);
  process.exit(1);
}

const r = await Tournament.updateMany(
  { eventId: event._id },
  { $set: { competitionDate: date } }
);

const list = await Tournament.find({ eventId: event._id }).select('name phase competitionDate').lean();
console.log(`已更新 ${r.modifiedCount} 個賽事 → ${date}（${event.name}）`);
for (const t of list) {
  console.log(`  - [${t.phase}] ${t.name}: ${t.competitionDate}`);
}

await mongoose.disconnect();
