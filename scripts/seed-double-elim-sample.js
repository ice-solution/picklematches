/**
 * 建立雙敗淘汰測試樣本（可重複執行：會重建同一 slug 下嘅雙敗賽事）
 * - 一局過（singleGame）
 * - 自動打完所有可打場次，留下完整賽果
 *
 * 用法：node scripts/seed-double-elim-sample.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { Event } from '../src/models/Event.js';
import { Tournament } from '../src/models/Tournament.js';
import { Team } from '../src/models/Team.js';
import { Match, MATCH_FORMAT } from '../src/models/Match.js';
import { MatchAssignment } from '../src/models/MatchAssignment.js';
import { Group } from '../src/models/Group.js';
import { generateDoubleElimFromTeams } from '../src/lib/doubleElimGenerator.js';
import { advanceKnockoutFromFinishedMatch } from '../src/lib/knockoutAdvance.js';

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/pickleball_tournament';
const EVENT_SLUG = 'de-sample-2026';
const TOURNAMENT_NAME = '雙敗示範組（8隊）';

const TEAM_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];

async function finishSingleGame(match, winnerIsA) {
  const teamA = match.teamA._id ?? match.teamA;
  const teamB = match.teamB._id ?? match.teamB;
  const scoreA = winnerIsA ? 11 : 5;
  const scoreB = winnerIsA ? 5 : 11;
  match.status = 'finished';
  match.completedGames = [{ a: scoreA, b: scoreB }];
  match.currentGameIndex = 1;
  match.currentPoints = { a: 0, b: 0 };
  match.winnerId = winnerIsA ? teamA : teamB;
  await match.save();
  await advanceKnockoutFromFinishedMatch(match._id);
}

/** 種子較細（排前面）嘅隊贏；無 seed 則 A 贏。總決賽第一場特例：敗部反勝以示範第二場 */
function pickWinnerIsA(match, opts = {}) {
  if (opts.forceLosersWinGf1 && match.bracketTrack === 'grand_final' && match.grandFinalLeg === 1) {
    return false; // teamB = GF-L 敗部冠軍
  }
  const a = match.teamA;
  const b = match.teamB;
  const sa = Number(a?.seed);
  const sb = Number(b?.seed);
  if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) {
    return sa < sb; // 細 seed 贏
  }
  return true;
}

async function playAllReadyMatches(tournamentId, { forceLosersWinGf1 = true } = {}) {
  let finished = 0;
  for (let guard = 0; guard < 80; guard++) {
    const candidates = await Match.find({
      tournamentId,
      status: 'scheduled',
    })
      .populate('teamA teamB')
      .sort({ createdAt: 1 });

    const ready = candidates.filter((m) => {
      if (m.status === 'cancelled') return false;
      if (!m.teamA || !m.teamB) return false;
      if (m.teamA.isPlaceholder || m.teamB.isPlaceholder) return false;
      // GF2 若仍係占位名但已換成真人 ID，上面 isPlaceholder 已 false
      return true;
    });

    if (!ready.length) break;

    // 一次只打一場，讓推進填完下一輪再繼續
    const m = ready[0];
    const winnerIsA = pickWinnerIsA(m, { forceLosersWinGf1 });
    await finishSingleGame(m, winnerIsA);
    finished += 1;
  }
  return finished;
}

async function run() {
  await connectDb(mongoUri);

  let event = await Event.findOne({ slug: EVENT_SLUG });
  if (!event) {
    event = await Event.create({
      name: '雙敗淘汰測試大會',
      slug: EVENT_SLUG,
      description: '自動產生嘅雙敗淘汰示範（8 隊、一局過、已有賽果）。用完可刪除此大會。',
      isActive: true,
      venues: [
        { slug: 'c1', name: '1號場', pinHash: '' },
        { slug: 'c2', name: '2號場', pinHash: '' },
      ],
    });
    console.log('已建立大會:', event.name, event._id.toString());
  } else {
    event.description = '自動產生嘅雙敗淘汰示範（8 隊、一局過、已有賽果）。用完可刪除此大會。';
    await event.save();
    console.log('沿用大會:', event.name, event._id.toString());
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
    console.log('已清空舊雙敗示範賽事場次／隊伍');
  } else {
    tournament = await Tournament.create({
      eventId: event._id,
      name: TOURNAMENT_NAME,
      phase: 'double_elim',
      advancePerGroup: 2,
      order: 0,
      competitionDate: '2026-09-20',
    });
    console.log('已建立賽事:', tournament.name, tournament._id.toString());
  }

  tournament.phase = 'double_elim';
  tournament.competitionDate = tournament.competitionDate || '2026-09-20';
  await tournament.save();

  for (let i = 0; i < TEAM_NAMES.length; i++) {
    await Team.create({
      tournamentId: tournament._id,
      name: TEAM_NAMES[i],
      code: `T${i + 1}`,
      seed: i + 1,
    });
  }
  console.log('已建立隊伍:', TEAM_NAMES.join(', '));

  const r = await generateDoubleElimFromTeams({
    tournamentId: tournament._id,
    matchFormat: MATCH_FORMAT.SINGLE_GAME,
  });

  if (!r.ok) {
    console.error('產生籤表失敗:', r.error);
    process.exit(1);
  }

  console.log('籤表已產生（一局過）:', {
    teams: r.createdTeams,
    matches: r.createdMatches,
    format: r.matchFormat,
  });

  const played = await playAllReadyMatches(tournament._id, { forceLosersWinGf1: true });
  console.log('已自動打完場次:', played);

  const stats = await Match.aggregate([
    { $match: { tournamentId: tournament._id } },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  console.log(
    '場次狀態:',
    Object.fromEntries(stats.map((s) => [s._id, s.n]))
  );

  const gf = await Match.find({
    tournamentId: tournament._id,
    bracketTrack: 'grand_final',
  })
    .populate('teamA teamB winnerId')
    .sort({ grandFinalLeg: 1 });

  for (const m of gf) {
    const a = m.teamA?.name || '?';
    const b = m.teamB?.name || '?';
    const w = m.winnerId?.name || (m.status === 'cancelled' ? '（已取消）' : '—');
    console.log(
      `  GF${m.grandFinalLeg}: ${a} vs ${b} → ${m.status} / 勝：${w}`
    );
  }

  const adminUrl = `http://localhost:${process.env.PORT || 5239}/admin/tournaments/${tournament._id}`;
  const publicUrl = `http://localhost:${process.env.PORT || 5239}/e/${EVENT_SLUG}`;
  console.log('\n測試連結：');
  console.log('  後台賽事:', adminUrl);
  console.log('  前台大會:', publicUrl);

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
