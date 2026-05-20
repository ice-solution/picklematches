import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';

/**
 * 若資料庫內沒有任何 admin，則建立一筆（方便全新 DB 或清空後啟動）。
 * 帳密可由環境變數覆寫，否則與 seed 示範相同。
 */
export async function ensureDefaultAdmin() {
  const hasAdmin = await User.exists({ role: 'admin' });
  if (hasAdmin) return;

  const email = String(process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@demo.local')
    .toLowerCase()
    .trim();
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || 'Demo1234');
  const name = String(process.env.BOOTSTRAP_ADMIN_NAME || '系統管理員').trim() || '系統管理員';

  const taken = await User.findOne({ email }).select('_id role').lean();
  if (taken) {
    console.warn(
      `[bootstrap] 無 admin 帳號，但信箱 ${email} 已被使用（role=${taken.role}）。請手動建立 admin 或刪除衝突帳號。`
    );
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ email, passwordHash, role: 'admin', name });
  console.warn(
    `[bootstrap] 已自動建立管理員：${email}（密碼預設與 seed 相同，可由 BOOTSTRAP_ADMIN_PASSWORD 設定）— 請登入後盡快變更密碼。`
  );
}
