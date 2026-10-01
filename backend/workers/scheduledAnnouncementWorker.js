const { publishDueAnnouncements } = require('../controllers/announcementsController');

let running = false;
let missingMigrationReported = false;

async function run() {
  if (running) return;
  running = true;
  try { await publishDueAnnouncements(); }
  catch (error) {
    if (error.code === 'ER_BAD_FIELD_ERROR' && !missingMigrationReported) {
      missingMigrationReported = true;
      console.error('Apply migration 017_announcement_media_schedule_pin.sql before using scheduled announcements.');
    } else if (error.code !== 'ER_BAD_FIELD_ERROR') {
      console.error('Scheduled announcement worker failed.', error);
    }
  }
  finally { running = false; }
}

function startScheduledAnnouncementWorker() {
  void run();
  setInterval(run, 10000).unref?.();
}

module.exports = { startScheduledAnnouncementWorker };
