import { Registration } from '../models/Registration.js';

/** 年齡（以比賽開始日或今日計算） */
export function memberAge(birthDate, onDate = new Date()) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  const d = new Date(onDate);
  let age = d.getFullYear() - b.getFullYear();
  const m = d.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) age -= 1;
  return age;
}

export function checkMemberDivisionEligibility(member, division, onDate = new Date()) {
  const r = division.restrictions || {};
  const issues = [];

  if (r.gender && r.gender !== 'open' && r.gender !== 'mixed') {
    if (!member.gender) issues.push('請在會員資料填寫性別');
    else if (member.gender !== r.gender) issues.push('性別不符合此組別要求');
  }

  const age = memberAge(member.birthDate, onDate);
  if (r.minAge != null && age != null && age < r.minAge) {
    issues.push(`年齡須滿 ${r.minAge} 歲`);
  }
  if (r.maxAge != null && age != null && age > r.maxAge) {
    issues.push(`年齡須不超過 ${r.maxAge} 歲`);
  }

  const dupr = member.duprRating;
  if (r.minDupr != null && dupr != null && dupr < r.minDupr) {
    issues.push(`DUPR 須不低於 ${r.minDupr}`);
  }
  if (r.maxDupr != null && dupr != null && dupr > r.maxDupr) {
    issues.push(`DUPR 須不高於 ${r.maxDupr}`);
  }

  return { ok: issues.length === 0, issues };
}

/** 組別有效報名隊數（待付款／已付／已確認） */
export async function countDivisionRegistrations(divisionId, statuses = ['pending_payment', 'paid', 'confirmed']) {
  return Registration.countDocuments({
    divisionId,
    status: { $in: statuses },
  });
}

export function isDivisionRegistrationOpen(division, now = new Date()) {
  if (!division.isPublished) return false;
  const open = division.registrationOpen ? new Date(division.registrationOpen) : null;
  const close = division.registrationClose ? new Date(division.registrationClose) : null;
  if (open && now < open) return false;
  if (close && now > close) return false;
  return true;
}
