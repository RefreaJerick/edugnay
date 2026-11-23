'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planSessions, run } = require('../scripts/backfillSaintColumbanStPeterDemoAttendance');

const meetings = [
  { date:'2026-11-17',subjectId:1,subject:'English',teacherId:10 },
  { date:'2026-11-17',subjectId:2,subject:'Science',teacherId:11 },
  { date:'2026-11-18',subjectId:1,subject:'English',teacherId:10 }
];
const studentIds = [21,22,23,24,25];

test('plans only missing scheduled subject dates and preserves existing sessions', () => {
  const existing = [{ date:'2026-11-17',subjectId:1,status:'confirmed',
    recordCount:5,studentIds }];
  assert.deepEqual(planSessions(meetings,existing,studentIds),meetings.slice(1));
  assert.deepEqual(planSessions(meetings,[...existing,
    ...meetings.slice(1).map(m => ({ ...m,status:'confirmed',recordCount:5,studentIds }))],studentIds),[]);
});

test('stops for incomplete or unrelated attendance instead of overwriting it', () => {
  assert.throws(() => planSessions(meetings,[{ date:'2026-11-17',subjectId:1,
    status:'confirmed',recordCount:4,studentIds:studentIds.slice(1) }],studentIds),
  /Incomplete attendance session/);
  assert.throws(() => planSessions(meetings,[{ date:'2026-11-17',subjectId:99,
    status:'confirmed',recordCount:5,studentIds }],studentIds),
  /Unexpected or duplicate attendance session/);
});

test('wrong database stops before taking a snapshot or writing records', async () => {
  let snapshotCalled=false;
  let writes=0;
  const connection={
    query:async () => [[{ name:'other',fk:1 }]],
    execute:async () => { writes++; throw new Error('Unexpected query'); },
    release() {}
  };
  const database={ getConnection:async () => connection };
  await assert.rejects(run({ apply:true,database,
    snapshot:() => { snapshotCalled=true; },confirm:async () => true }),
  /Expected academix/);
  assert.equal(snapshotCalled,false);
  assert.equal(writes,0);
});

test('apply adds only missing demo sessions with five records each and verifies them', async () => {
  const stored=[];
  const attendance=[];
  let snapshotCalled=false;
  let commits=0;
  const connection={
    query:async () => [[{ name:'academix',fk:1 }]],
    async execute(sql,params=[]) {
      assert.equal((sql.match(/\?/g)||[]).length,params.length,`Placeholder mismatch: ${sql}`);
      if (sql.includes('FROM sections s')) return [[{ id:12 }]];
      if (sql.includes('FROM section_students e')) return [studentIds.map(id => ({ id }))];
      if (sql.includes('FROM timetable_meetings tm')) return [[
        { subjectId:params[2] === 2 ? 1 : 2, subject:'Example',teacherId:10 }
      ]];
      if (sql.includes('FROM attendance_sessions s LEFT JOIN attendance_records r'))
        return [stored.flatMap(s => attendance.filter(r => r.sessionId === s.id)
          .map(r => ({ id:s.id,date:s.date,subjectId:s.subjectId,status:'confirmed',
            studentId:r.studentId })))];
      if (sql.includes('FOR UPDATE')) return [[{ id:12 }]];
      if (sql.includes('INSERT INTO attendance_sessions')) {
        const id=stored.length+1;
        stored.push({ id,date:params[3],subjectId:params[2] });
        return [{ insertId:id }];
      }
      if (sql.includes('INSERT INTO attendance_records')) {
        assert.equal(params[3].startsWith('Synthetic demo attendance'),true);
        attendance.push({ sessionId:params[1],studentId:params[2] });
        return [{ insertId:attendance.length }];
      }
      if (sql.includes('INSERT INTO audit_logs')) return [{ insertId:1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    beginTransaction:async () => {},
    commit:async () => { commits++; },
    rollback:async () => { throw new Error('Unexpected rollback'); },
    release() {}
  };
  const database={ getConnection:async () => connection };
  const originalLog=console.log;
  console.log=() => {};
  try {
    const preview=await run({ database });
    assert.equal(preview.sessionsToAdd,2);
    const result=await run({ apply:true,database,confirm:async () => true,
      snapshot:() => { snapshotCalled=true; return 'available-test-snapshot'; } });
    assert.equal(result.sessionsAdded,2);
    assert.equal(result.recordsAdded,10);
    assert.equal(result.verified,true);
  } finally { console.log=originalLog; }
  assert.equal(snapshotCalled,true);
  assert.equal(commits,1);
  assert.equal(stored.length,2);
  assert.equal(attendance.length,10);
});
