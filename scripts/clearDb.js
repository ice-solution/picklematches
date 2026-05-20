import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import '../src/models/index.js';

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pickleball_tournament';

async function run() {
  if (!process.argv.includes('--yes')) {
    console.error('此操作會刪除目前 MONGODB_URI 所連線的「整個資料庫」內所有集合與資料（含 Session）。');
    console.error('若確定要清空，請執行：');
    console.error('  npm run db:clear');
    console.error('或：');
    console.error('  node scripts/clearDb.js --yes');
    process.exit(1);
  }

  await connectDb(mongoUri);
  const name = mongoose.connection.db.databaseName;
  console.log('即將清空資料庫：', name);
  await mongoose.connection.dropDatabase();
  console.log('已清空。若要示範資料可再執行：npm run seed');
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
