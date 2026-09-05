import { OpenSession } from '../models/OpenSession.js';

export function syncOpenSessionStatus(session) {
  const count = (session.participantIds || []).length;
  if (session.status === 'cancelled' || session.status === 'completed') return session.status;
  if (count >= session.maxPlayers) {
    session.status = 'full';
  } else if (session.status === 'full') {
    session.status = 'open';
  }
  return session.status;
}

export async function joinOpenSession(sessionId, memberId) {
  const session = await OpenSession.findById(sessionId);
  if (!session) return { ok: false, error: 'not_found' };
  if (session.status === 'cancelled' || session.status === 'completed') {
    return { ok: false, error: 'closed' };
  }
  const mid = String(memberId);
  const ids = (session.participantIds || []).map(String);
  if (ids.includes(mid)) return { ok: false, error: 'already_joined' };
  if (ids.length >= session.maxPlayers) return { ok: false, error: 'full' };

  session.participantIds.push(memberId);
  syncOpenSessionStatus(session);
  await session.save();
  return { ok: true, session };
}

export async function leaveOpenSession(sessionId, memberId) {
  const session = await OpenSession.findById(sessionId);
  if (!session) return { ok: false, error: 'not_found' };
  if (String(session.hostMemberId) === String(memberId)) {
    return { ok: false, error: 'host_cannot_leave' };
  }
  session.participantIds = (session.participantIds || []).filter((id) => String(id) !== String(memberId));
  syncOpenSessionStatus(session);
  await session.save();
  return { ok: true, session };
}
