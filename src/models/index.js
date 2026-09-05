/**
 * 啟動時載入所有 Mongoose model，否則 populate('teamA'|'teamB'|'winnerId') 會出現
 * MissingSchemaError: Schema hasn't been registered for model "Team".
 */
import './User.js';
import './Event.js';
import './Tournament.js';
import './Group.js';
import './Team.js';
import './Match.js';
import './MatchAssignment.js';
import './DisplayContent.js';
import './AuditLog.js';
import './Member.js';
import './Alliance.js';
import './AllianceMember.js';
import './OpenSession.js';
import './Division.js';
import './Registration.js';
import './PaymentTransaction.js';
