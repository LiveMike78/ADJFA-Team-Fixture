#!/usr/bin/env node

/**
 * entrypoint.js
 * Runs sync immediately on container start, then on a repeating interval.
 * UPDATE_FREQUENCY is in minutes (default: 360 = every 6 hours).
 */

const { spawn } = require('child_process');

const FREQUENCY_MINUTES = parseInt(process.env.UPDATE_FREQUENCY || '360', 10);
const FREQUENCY_MS      = FREQUENCY_MINUTES * 60 * 1000;

function runSync() {
  const child = spawn('node', ['/app/src/sync.js'], {
    stdio: 'inherit',
    env:   process.env,
  });
  child.on('exit', code => {
    if (code && code !== 0) {
      console.error(`[SCHEDULER] Sync process exited with code ${code}`);
    }
  });
}

console.log('┌─────────────────────────────────────────┐');
console.log('│       ⚽  ADJFA Team Fixture                │');
console.log('│  Football fixture → Google Calendar sync  │');
console.log('└─────────────────────────────────────────┘');
console.log(`[SCHEDULER] Update frequency : every ${FREQUENCY_MINUTES} minutes`);
console.log(`[SCHEDULER] Team             : ${process.env.TEAM_NAME || '(not set)'}`);
console.log(`[SCHEDULER] Calendar ID      : ${process.env.CALENDAR_ID || '(not set)'}`);
console.log('');

runSync();
setInterval(runSync, FREQUENCY_MS);

process.on('SIGTERM', () => { console.log('[SCHEDULER] SIGTERM received, exiting.'); process.exit(0); });
process.on('SIGINT',  () => { console.log('[SCHEDULER] SIGINT received, exiting.');  process.exit(0); });
