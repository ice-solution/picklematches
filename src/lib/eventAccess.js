import mongoose from 'mongoose';
import { Event } from '../models/Event.js';
import { Tournament } from '../models/Tournament.js';
import { Match } from '../models/Match.js';

export const BACKOFFICE_ROLES = ['admin', 'staff', 'owner'];
export const ALLIANCE_REVIEW_ROLES = ['admin', 'staff'];

export function isGlobalStaff(role) {
  return role === 'admin' || role === 'staff';
}

export function isOwnerRole(role) {
  return role === 'owner';
}

/** 列表用：owner 只看自己的大會 */
export function eventListFilter(session) {
  if (isGlobalStaff(session?.role)) return {};
  if (isOwnerRole(session?.role) && session?.userId) {
    return { ownerId: session.userId };
  }
  return { _id: null };
}

export function canAccessEventDoc(session, event) {
  if (!event) return false;
  if (isGlobalStaff(session?.role)) return true;
  if (isOwnerRole(session?.role)) {
    return String(event.ownerId || '') === String(session.userId || '');
  }
  return false;
}

export async function findAccessibleEvent(session, eventId) {
  if (!mongoose.isValidObjectId(eventId)) return null;
  const event = await Event.findById(eventId);
  if (!canAccessEventDoc(session, event)) return null;
  return event;
}

export async function findAccessibleEventLean(session, eventId) {
  if (!mongoose.isValidObjectId(eventId)) return null;
  const event = await Event.findById(eventId).lean();
  if (!canAccessEventDoc(session, event)) return null;
  return event;
}

export async function findAccessibleTournament(session, tournamentId) {
  if (!mongoose.isValidObjectId(tournamentId)) return null;
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) return null;
  const event = await Event.findById(tournament.eventId).select('ownerId').lean();
  if (!canAccessEventDoc(session, event)) return null;
  return tournament;
}

export async function findAccessibleMatch(session, matchId) {
  if (!mongoose.isValidObjectId(matchId)) return null;
  const match = await Match.findById(matchId);
  if (!match) return null;
  const tournament = await Tournament.findById(match.tournamentId).select('eventId').lean();
  if (!tournament) return null;
  const event = await Event.findById(tournament.eventId).select('ownerId').lean();
  if (!canAccessEventDoc(session, event)) return null;
  return match;
}

export function forbidAccess(req, res) {
  if (req.path?.startsWith('/api') || req.headers.accept?.includes('application/json')) {
    return res.status(403).json({ error: 'forbidden' });
  }
  return res.status(403).render('pages/error', {
    title: '無權限',
    message: '你沒有權限存取此資源。',
  });
}
