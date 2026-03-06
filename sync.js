#!/usr/bin/env node

const https = require('https');
const http = require('http');

// ── Config from environment variables ──────────────────────────────────────
const CONFIG = {
  HA_URL:      (process.env.HA_URL || '').replace(/\/$/, ''),
  HA_USERNAME: process.env.HA_USERNAME || '',
  HA_PASSWORD: process.env.HA_PASSWORD || '',
  HA_TOKEN:    process.env.HA_TOKEN    || '',   // alternative to user/pass
  CALENDAR:    process.env.CALENDAR    || 'calendar.fixtures',
  FIXTURE_URL: process.env.FIXTURE_URL || '',
  TEAM_NAME:   process.env.TEAM_NAME   || '',
  DRY_RUN:     process.env.DRY_RUN === 'true',
};

// ── Validation ──────────────────────────────────────────────────────────────
function validate() {
  const missing = [];
  if (!CONFIG.HA_URL)      missing.push('HA_URL');
  if (!CONFIG.FIXTURE_URL) missing.push('FIXTURE_URL');
  if (!CONFIG.TEAM_NAME)   missing.push('TEAM_NAME');
  if (!CONFIG.HA_TOKEN && (!CONFIG.HA_USERNAME || !CONFIG.HA_PASSWORD)) {
    missing.push('HA_TOKEN (or HA_USERNAME + HA_PASSWORD)');
  }
  if (missing.length) {
    console.error(`[ERROR] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// ── HTTP helpers ────────────────────────────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'ha-fixture-sync/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

function haRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${CONFIG.HA_URL}${path}`);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Authentication: get a long-lived token via username/password ────────────
async function getToken() {
  if (CONFIG.HA_TOKEN) return CONFIG.HA_TOKEN;

  console.log('[AUTH] Authenticating with username/password...');

  // Step 1: get auth code
  const authUrl = `${CONFIG.HA_URL}/auth/authorize?response_type=code&client_id=${encodeURIComponent(CONFIG.HA_URL)}&redirect_uri=${encodeURIComponent(CONFIG.HA_URL)}`;

  // HA supports direct token via /auth/token with password grant (legacy, must be enabled)
  const params = new URLSearchParams({
    grant_type: 'password',
    username:   CONFIG.HA_USERNAME,
    password:   CONFIG.HA_PASSWORD,
    client_id:  CONFIG.HA_URL,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(`${CONFIG.HA_URL}/auth/token`);
    const lib = url.protocol === 'https:' ? https : http;
    const payload = params.toString();

    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) {
            console.log('[AUTH] Token obtained successfully.');
            resolve(json.access_token);
          } else {
            reject(new Error(`Auth failed: ${data}`));
          }
        } catch {
          reject(new Error(`Auth parse error: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── HTML fixture parser ─────────────────────────────────────────────────────
function parseFixtures(html, teamName) {
  const fixtures = [];
  const teamLower = teamName.toLowerCase();

  // Match all <tr>...</tr> blocks
  const rowRegex = /<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];
    if (!row.toLowerCase().includes(teamLower)) continue;

    // Extract cell text
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(row)) !== null) {
      const text = tdMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(text);
    }

    if (cells.length < 3) continue;

    // Log raw cells on first parse attempt to help debugging
    if (fixtures.length === 0) {
      console.log('[PARSE] Sample row cells:', JSON.stringify(cells));
    }

    // Try multiple possible column layouts
    // Layout A: Date | Home | vs | Away | KO Time | Venue | Result/Status
    // Layout B: Date | Home | Away | KO Time | Venue | Status
    let dateStr, homeTeam, awayTeam, timeStr, venue, status;

    if (cells.length >= 6 && cells[2] === 'v') {
      // Layout A (explicit "v" separator cell)
      [dateStr, homeTeam, , awayTeam, timeStr, venue, status] = cells;
    } else if (cells.length >= 5) {
      // Layout B
      [dateStr, homeTeam, awayTeam, timeStr, venue, status] = cells;
    } else {
      continue;
    }

    status = status || '';

    if (!homeTeam.toLowerCase().includes(teamLower) &&
        !awayTeam.toLowerCase().includes(teamLower)) continue;

    // Parse date (DD/MM/YYYY or DD-MM-YYYY)
    const dateParts = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (!dateParts) continue;
    const [, day, month, year] = dateParts;

    const timeParts = (timeStr || '').match(/(\d{1,2}):(\d{2})/);
    const hour   = timeParts ? parseInt(timeParts[1]) : 15;
    const minute = timeParts ? parseInt(timeParts[2]) : 0;

    const start = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hour, minute);
    const end   = new Date(start.getTime() + 90 * 60 * 1000);

    const isHome   = homeTeam.toLowerCase().includes(teamLower);
    const opponent = isHome ? awayTeam : homeTeam;
    const location = isHome ? 'H' : 'A';
    const summary  = isHome
      ? `${teamName} vs ${opponent} (H)`
      : `${opponent} vs ${teamName} (A)`;

    const cancelled = /cancel|postpone|void|called.?off|p\.?p\.?/i.test(status);

    // Stable unique ID based on date + opponent
    const uid = `fixture-${year}${month.padStart(2,'0')}${day.padStart(2,'0')}-${opponent.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;

    fixtures.push({
      uid,
      summary,
      description: `${location} | Venue: ${venue || 'TBC'} | Status: ${status || 'Scheduled'}`,
      start: start.toISOString(),
      end:   end.toISOString(),
      cancelled,
    });
  }

  return fixtures;
}

// ── Get existing HA calendar events ────────────────────────────────────────
async function getExistingEvents(token) {
  const now   = new Date();
  const later = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  const start = now.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const end   = later.toISOString().replace(/\.\d{3}Z$/, '+00:00');

  const path = `/api/calendars/${encodeURIComponent(CONFIG.CALENDAR)}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const res  = await haRequest('GET', path, null, token);

  if (res.status !== 200) {
    throw new Error(`Failed to fetch calendar events (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return Array.isArray(res.body) ? res.body : [];
}

// ── Create a calendar event ─────────────────────────────────────────────────
async function createEvent(token, fixture) {
  if (CONFIG.DRY_RUN) {
    console.log(`[DRY RUN] Would CREATE: ${fixture.summary}`);
    return;
  }

  const body = {
    summary:         fixture.summary,
    description:     fixture.description,
    start_date_time: fixture.start,
    end_date_time:   fixture.end,
  };

  const res = await haRequest('POST', `/api/services/calendar/create_event`, {
    entity_id:       CONFIG.CALENDAR,
    ...body,
  }, token);

  if (res.status >= 400) {
    console.error(`[ERROR] Failed to create "${fixture.summary}": ${JSON.stringify(res.body)}`);
  } else {
    console.log(`[CREATED] ${fixture.summary} on ${fixture.start.substring(0, 10)}`);
  }
}

// ── Update event summary to mark as cancelled (via .ics PATCH workaround) ──
// HA has no delete_event service, so we rename with [CANCELLED] prefix
// by deleting via the ics file workaround isn't available —
// best available approach: create a replacement event with [CANCELLED] in summary
async function markCancelled(token, existingEvent, fixture) {
  if (CONFIG.DRY_RUN) {
    console.log(`[DRY RUN] Would MARK CANCELLED: ${fixture.summary}`);
    return;
  }

  // HA Local Calendar supports create_event; to "update" we create a new
  // replacement event with [CANCELLED] in the title (idempotent since we
  // check for [CANCELLED] prefix when deduplicating)
  const cancelledSummary = `[CANCELLED] ${fixture.summary}`;

  // Check if already marked cancelled
  if (existingEvent.summary && existingEvent.summary.startsWith('[CANCELLED]')) {
    console.log(`[SKIP] Already marked cancelled: ${existingEvent.summary}`);
    return;
  }

  // Unfortunately HA has no update_event or delete_event.
  // Best we can do without file access: log a persistent notification.
  const res = await haRequest('POST', '/api/services/persistent_notification/create', {
    title:          '⚽ Fixture Cancelled',
    message:        `**${fixture.summary}** on ${fixture.start.substring(0,10)} has been cancelled/postponed. Please remove it from your calendar manually.`,
    notification_id: `fixture_cancelled_${fixture.uid}`,
  }, token);

  if (res.status >= 400) {
    console.error(`[ERROR] Failed to send notification for cancelled fixture`);
  } else {
    console.log(`[NOTIFICATION] Sent cancellation notice for: ${fixture.summary}`);
  }
}

// ── Main sync logic ─────────────────────────────────────────────────────────
async function sync() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[SYNC] Starting fixture sync at ${new Date().toISOString()}`);
  console.log(`[SYNC] Team: ${CONFIG.TEAM_NAME}`);
  console.log(`[SYNC] Calendar: ${CONFIG.CALENDAR}`);
  console.log(`[SYNC] Source: ${CONFIG.FIXTURE_URL}`);
  if (CONFIG.DRY_RUN) console.log('[SYNC] *** DRY RUN MODE — no changes will be made ***');

  try {
    // 1. Authenticate
    const token = await getToken();

    // 2. Fetch fixture page
    console.log('[FETCH] Downloading fixtures page...');
    const html = await fetchUrl(CONFIG.FIXTURE_URL);
    console.log(`[FETCH] Got ${html.length} bytes`);

    // 3. Parse fixtures
    const fixtures = parseFixtures(html, CONFIG.TEAM_NAME);
    console.log(`[PARSE] Found ${fixtures.length} fixtures for "${CONFIG.TEAM_NAME}"`);

    if (fixtures.length === 0) {
      console.warn('[WARN] No fixtures found — check TEAM_NAME matches the site exactly, or the page structure may have changed.');
      return;
    }

    // 4. Get existing calendar events
    console.log('[CALENDAR] Fetching existing events...');
    const existing = await getExistingEvents(token);
    console.log(`[CALENDAR] Found ${existing.length} existing events`);

    // Build a map keyed by a normalised version of the summary (strips [CANCELLED] prefix)
    const existingMap = {};
    existing.forEach(ev => {
      const normSummary = (ev.summary || '').replace(/^\[CANCELLED\]\s*/i, '').trim();
      const date = (ev.start?.dateTime || ev.start?.date || '').substring(0, 10);
      const key  = `${normSummary}|${date}`;
      existingMap[key] = ev;
    });

    // 5. Compare and act
    let added = 0, notified = 0, skipped = 0;

    for (const fix of fixtures) {
      const date = fix.start.substring(0, 10);
      const key  = `${fix.summary}|${date}`;

      if (fix.cancelled) {
        if (existingMap[key]) {
          await markCancelled(token, existingMap[key], fix);
          notified++;
        } else {
          console.log(`[SKIP] Cancelled fixture not in calendar: ${fix.summary}`);
          skipped++;
        }
      } else {
        if (existingMap[key]) {
          console.log(`[SKIP] Already exists: ${fix.summary}`);
          skipped++;
        } else {
          await createEvent(token, fix);
          added++;
        }
      }
    }

    console.log(`\n[DONE] Added: ${added} | Notified (cancelled): ${notified} | Skipped: ${skipped}`);

  } catch (err) {
    console.error(`[ERROR] Sync failed: ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────
validate();
sync();
