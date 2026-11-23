'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run, DATES, ITEMS, WORK, scoreBand, attendanceStatus } =
  require('../scripts/prepareSaintColumbanStPeterReportDemo');

const names = ['Isabel Camille Del Rosario', 'Marco Daniel Dimaculangan',
  'Angela Rose Evangelista', 'Luis Mateo Fajardo', 'Francesca Marie Velasco'];
function scope() {
  return {
    section:{ id:12, adviserId:20 }, termId:4,
    students:names.map((name,index)=>({ id:30+index,name })),
    subjects:[{ id:7,name:'Mathematics',teacherId:40 },
      { id:8,name:'Science',teacherId:41 }],
    components:[
      { subjectId:7,kind:'written',categoryId:1,componentId:11 },
      { subjectId:7,kind:'performance',categoryId:2,componentId:12 },
      { subjectId:8,kind:'written',categoryId:1,componentId:13 },
      { subjectId:8,kind:'performance',categoryId:2,componentId:14 }
    ],
    reportIds:[50,51,52,53,54],releaseIds:[60,61,62,63,64],notificationIds:[70],
    links:{ recommendations:10,sources:25 },
    missing:[{ date:'2026-11-20',subjectId:8,subject:'Science',teacherId:41 }],
    existingSessions:14,scheduledSessions:15
  };
}
function fakeDatabase({ failInsert=false }={}) {
  const sql=[];
  let nextId=100;
  let rollback=0;
  let commit=0;
  const connection={
    async execute(statement,params=[]) {
      assert.equal((statement.match(/\?/g)||[]).length,params.length,statement);
      sql.push(statement);
      if(statement.includes('FROM narrative_reports WHERE school_id=? AND section_id=?') &&
        statement.includes('FOR UPDATE')) return [scope().reportIds.map(id=>({ id }))];
      if(failInsert && statement.includes('INSERT INTO grading_items')) throw new Error('insert failed');
      if(statement.includes('DELETE FROM notifications')) return [{ affectedRows:1 }];
      if(statement.includes('DELETE FROM narrative_report_releases')) return [{ affectedRows:5 }];
      if(statement.includes('DELETE FROM report_data_sources')) return [{ affectedRows:25 }];
      if(statement.includes('DELETE FROM report_recommendations')) return [{ affectedRows:10 }];
      if(statement.includes('DELETE FROM narrative_reports')) return [{ affectedRows:5 }];
      return [{ insertId:nextId++,affectedRows:1 }];
    },
    async query(statement) {
      sql.push(statement);
      if(statement.startsWith('SHOW CREATE TRIGGER')) return [[{
        'SQL Original Statement':"SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Released report snapshots cannot be deleted'"
      }]];
      return [[]];
    },
    async beginTransaction() { sql.push('BEGIN'); },
    async commit() { commit++;sql.push('COMMIT'); },
    async rollback() { rollback++;sql.push('ROLLBACK'); },
    release() {}
  };
  return { database:{ async getConnection(){ return connection; } },sql,
    counts:()=>({ commit,rollback }) };
}
function options(fake,extra={}) {
  return { database:fake.database,scopeReader:async()=>scope(),verifyScope:async()=>{},
    evidenceBuilder:async()=>({ students:names.map((displayName,index)=>({
      displayName,assignments:{ total:2 },academicScores:[{ title:ITEMS[0].title,
        subjectName:ITEMS[0].subject }],followUpCandidate:index<2 })) }),
    snapshot:()=> 'available-test-snapshot',confirm:async()=>true,serviceStopped:()=>{},
    targetChecked:()=>{},...extra };
}
async function withoutLog(action) {
  const original=console.log;
  console.log=()=>{};
  try { return await action(); } finally { console.log=original; }
}

test('plans varied grades, two manually checked assignments, and distinct risk attendance',()=>{
  assert.deepEqual(DATES.map(day=>day.date),[
    '2026-11-17','2026-11-18','2026-11-19','2026-11-20']);
  assert.equal(ITEMS.length,6);
  assert.equal(WORK.length,2);
  assert.deepEqual(scoreBand(ITEMS.flatMap(item=>item.scores)),{ below75:12,atLeast75:18 });
  assert.deepEqual(new Set(WORK.map(item=>item.subject)),new Set(['Mathematics','Science']));
  assert.ok(WORK.every(item=>['submitted','late','not_submitted'].every(status=>item.statuses.includes(status))));
  assert.equal(attendanceStatus(0,'2026-11-19','Mathematics'),'absent');
  assert.equal(attendanceStatus(1,'2026-11-20','Science'),'absent');
});

test('preview and cancelled apply do not mutate the database',async()=>{
  const fake=fakeDatabase();
  const preview=await withoutLog(()=>run(options(fake,{ apply:false })));
  assert.equal(preview.remove.reports.length,5);
  assert.equal(preview.add.scoreItems,6);
  assert.equal(fake.sql.length,0);
  await withoutLog(()=>run(options(fake,{ apply:true,confirm:async()=>false })));
  assert.equal(fake.sql.length,0);
});

test('apply snapshots, deletes only scoped reports, inserts evidence, and restores the trigger',async()=>{
  const fake=fakeDatabase();
  const result=await withoutLog(()=>run(options(fake,{ apply:true })));
  assert.equal(result.verified,true);
  assert.deepEqual(fake.counts(),{ commit:1,rollback:0 });
  assert.equal(fake.sql.filter(sql=>sql.startsWith('DROP TRIGGER')).length,1);
  assert.equal(fake.sql.filter(sql=>sql.startsWith('CREATE TRIGGER')).length,1);
  assert.equal(fake.sql.filter(sql=>sql.includes('INSERT INTO grading_items')).length,6);
  assert.equal(fake.sql.filter(sql=>sql.includes('INSERT INTO student_scores')).length,30);
  assert.equal(fake.sql.filter(sql=>sql.includes('INSERT INTO assignments')).length,2);
  assert.equal(fake.sql.filter(sql=>sql.includes('INSERT INTO assignment_submissions')).length,10);
  assert.equal(fake.sql.filter(sql=>sql.includes('INSERT INTO attendance_records')).length,5);
  assert.ok(fake.sql.indexOf('COMMIT') < fake.sql.findIndex(sql=>sql.startsWith('CREATE TRIGGER')));
});

test('failed insert rolls back data and restores released-report protection',async()=>{
  const fake=fakeDatabase({ failInsert:true });
  await assert.rejects(withoutLog(()=>run(options(fake,{ apply:true }))),/insert failed/);
  assert.deepEqual(fake.counts(),{ commit:0,rollback:1 });
  assert.equal(fake.sql.filter(sql=>sql.startsWith('CREATE TRIGGER')).length,1);
});

test('a missing snapshot or changed scope stops before dropping the protection trigger',async()=>{
  const first=fakeDatabase();
  await assert.rejects(withoutLog(()=>run(options(first,{ apply:true,
    snapshot:()=>{ throw new Error('snapshot unavailable'); } }))),/snapshot unavailable/);
  assert.equal(first.sql.length,0);

  const second=fakeDatabase();
  let calls=0;
  await assert.rejects(withoutLog(()=>run(options(second,{ apply:true,
    scopeReader:async()=>{
      const value=scope();
      if(++calls===2) value.reportIds[0]=999;
      return value;
    } }))),/changed after preview/);
  assert.equal(second.sql.filter(sql=>sql.startsWith('DROP TRIGGER')).length,0);
});
