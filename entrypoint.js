#!/usr/bin/env node

/**
 * entrypoint.js
 * Runs sync immediately on start, then schedules repeats based on
 * UPDATE_FREQUENCY env var (in minutes, default 360 = 6 hours).
 */

const { execSync, spawn } = require('child_process');

const FREQUENCY_MINUTES = parseInt(process.env.UPDATE_FREQUENCY || '360', 10);
const FREQUENCY_MS      = FREQUENCY_MINUTES * 60 * 1000;

function runSync() {
  console.log(`\n[SCHEDULER] Triggering sync (next run in ${FREQUENCY_MINUTES} minutes)`);
  const child = spawn('node', ['/app/src/sync.js'], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[SCHEDULER] Sync exited with code ${code}`);
    }
  });
}

console.log(`[SCHEDULER] HA Fixture Sync starting`);
console.log(`[SCHEDULER] Update frequency: every ${FREQUENCY_MINUTES} minutes`);
console.log(`[SCHEDULER] Team: ${process.env.TEAM_NAME || '(not set)'}`);
console.log(`[SCHEDULER] Calendar: ${process.env.CALENDAR || '(not set)'}`);

// Run immediately
runSync();

// Then repeat
setInterval(runSync, FREQUENCY_MS);

// Keep process alive
process.on('SIGTERM', () => {
  console.log('[SCHEDULER] Received SIGTERM, shutting down gracefully.');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('[SCHEDULER] Received SIGINT, shutting down.');
  process.exit(0);
});
