#!/usr/bin/env node

/**
 * sync.js
 * Fetches fixtures for a given team from a league website
 * and syncs them into a Google Calendar via the Google Calendar API v3,
 * using a Service Account for authentication.
 */

const https = require('https');
const http  = require('http');
const crypto = require('crypto');

// ── Config ──────────────────────────────────────────────────────────────────
const CONFIG = {
  // Google
  GOOGLE_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '',
  CALENDAR_ID:                 process.env.CALENDAR_ID || '',

  // Fixtures
  FIXTURE_URL: process.env.FIXTURE_URL || '',
  TEAM_NAME:   process.env.TEAM_NAME   || '',

  // Behaviour
  DRY_RUN: process.env.DRY_RUN === 'true',
  DEBUG:   process.env.DEBUG   === 'true',
};

// ── Validation ──────────────────────────────────────────────────────────────
function validate() {
  const missing = [];
  if (!CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON) missing.push('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!CONFIG.CALENDAR_ID)                 missing.push('CALENDAR_ID');
  if (!CONFIG.FIXTURE_URL)                 missing.push('FIXTURE_URL');
  if (!CONFIG.TEAM_NAME)                   missing.push('TEAM_NAME');
  if (missing.length) {
    console.error(`[ERROR] Missing required environment variables:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }

  try {
    JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch {
    console.error('[ERROR] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
    process.exit(1);
  }
}

// ── HTTP helper ──────────────────────────────────────────────────────────────
function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const reqOptions = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers: {
        'User-Agent': 'adjfa-team-fixture/1.0',
        ...(options.headers || {}),
        ...(payload ? {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
        } : {}),
      },
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, raw: data });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'adjfa-team-fixture/1.0' } }, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetchHtml(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        else resolve(data);
      });
    }).on('error', reject);
  });
}

// ── Google Service Account JWT auth ─────────────────────────────────────────
// Implements the JWT Bearer token flow entirely in Node stdlib (no google-auth-library needed)

function base64urlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function signJwt(header, payload, privateKeyPem) {
  const input = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(JSON.stringify(payload))}`;
  const sign   = crypto.createSign('RSA-SHA256');
  sign.update(input);
  const sig = sign.sign(privateKeyPem, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${input}.${sig}`;
}

async function getAccessToken(serviceAccount) {
  const now     = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss:   serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  };

  // Google service account JSON stores the key with literal \n — normalise
  const privateKey = serviceAccount.private_key.replace(/\\n/g, '\n');
  const jwt        = signJwt(header, payload, privateKey);

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion:  jwt,
  }).toString();

  return new Promise((resolve, reject) => {
    const payload_buf = Buffer.from(body);
    const options = {
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': payload_buf.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error(`Token exchange failed: ${data}`));
        } catch {
          reject(new Error(`Token parse error: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Fixture parser ───────────────────────────────────────────────────────────
function parseFixtures(html, teamName) {
  const fixtures  = [];
  const teamLower = teamName.toLowerCase();
  const rowRegex  = /<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const row = rowMatch[1];
    if (!row.toLowerCase().includes(teamLower)) continue;

    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells   = [];
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

    if (fixtures.length === 0) {
      console.log('[PARSE] Sample row cells:', JSON.stringify(cells));
    }

    let dateStr, homeTeam, awayTeam, timeStr, venue, status;

    if (cells.length >= 6 && /^v(s)?$/i.test(cells[2])) {
      [dateStr, homeTeam, , awayTeam, timeStr, venue, status] = cells;
    } else if (cells.length >= 5) {
      [dateStr, homeTeam, awayTeam, timeStr, venue, status] = cells;
    } else {
      continue;
    }

    status = (status || '').trim();

    if (!homeTeam.toLowerCase().includes(teamLower) &&
        !awayTeam.toLowerCase().includes(teamLower)) continue;

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
    const summary  = isHome
      ? `${teamName} vs ${opponent} (H)`
      : `${opponent} vs ${teamName} (A)`;

    const cancelled = /cancel|postpone|void|called.?off|p\.?p\.?/i.test(status);

    // Stable ID stored as an extended property — used for deduplication & deletion
    const fixtureId = `fixture-${year}${month.padStart(2,'0')}${day.padStart(2,'0')}-${opponent.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;

    fixtures.push({
      fixtureId,
      summary,
      description: `${isHome ? 'Home' : 'Away'} | Venue: ${venue || 'TBC'} | Status: ${status || 'Scheduled'}`,
      start: start.toISOString(),
      end:   end.toISOString(),
      cancelled,
    });
  }

  return fixtures;
}

// ── Google Calendar API helpers ──────────────────────────────────────────────
const GCAL_BASE = 'https://www.googleapis.com/calendar/v3';

async function listEvents(token, calendarId) {
  const now    = new Date().toISOString();
  const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  // Use privateExtendedProperty to find only events we created
  const params = new URLSearchParams({
    timeMin:                  now,
    timeMax:                  future,
    privateExtendedProperty:  'managedBy=adjfa-team-fixture',
    maxResults:               '2500',
    singleEvents:             'true',
  });

  const url = `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
  const res = await request(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status !== 200) {
    throw new Error(`Failed to list events (${res.status}): ${JSON.stringify(res.body)}`);
  }

  return res.body.items || [];
}

async function createEvent(token, calendarId, fixture) {
  if (CONFIG.DRY_RUN) {
    console.log(`[DRY RUN] Would CREATE: ${fixture.summary}`);
    return;
  }

  const event = {
    summary:     fixture.summary,
    description: fixture.description,
    start: { dateTime: fixture.start, timeZone: 'Europe/London' },
    end:   { dateTime: fixture.end,   timeZone: 'Europe/London' },
    extendedProperties: {
      private: {
        managedBy: 'adjfa-team-fixture',
        fixtureId: fixture.fixtureId,
      },
    },
  };

  const url = `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
  const res = await request(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
  }, event);

  if (res.status >= 400) {
    console.error(`[ERROR] Failed to create "${fixture.summary}": ${JSON.stringify(res.body)}`);
  } else {
    console.log(`[CREATED] ${fixture.summary} — ${fixture.start.substring(0, 10)}`);
  }
}

async function deleteEvent(token, calendarId, googleEventId, summary) {
  if (CONFIG.DRY_RUN) {
    console.log(`[DRY RUN] Would DELETE: ${summary}`);
    return;
  }

  const url = `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${googleEventId}`;
  const res = await request(url, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 204 || res.status === 200) {
    console.log(`[DELETED] ${summary}`);
  } else {
    console.error(`[ERROR] Failed to delete "${summary}" (${res.status}): ${JSON.stringify(res.body)}`);
  }
}

// ── Main sync ────────────────────────────────────────────────────────────────
async function sync() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[SYNC] Starting at ${new Date().toISOString()}`);
  console.log(`[SYNC] Team:     ${CONFIG.TEAM_NAME}`);
  console.log(`[SYNC] Calendar: ${CONFIG.CALENDAR_ID}`);
  console.log(`[SYNC] Source:   ${CONFIG.FIXTURE_URL}`);
  if (CONFIG.DRY_RUN) console.log('[SYNC] *** DRY RUN — no changes will be made ***');

  // 1. Parse service account + get token
  const serviceAccount = JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
  console.log(`[AUTH] Authenticating as ${serviceAccount.client_email}...`);
  const token = await getAccessToken(serviceAccount);
  console.log('[AUTH] Access token obtained.');

  // 2. Fetch fixtures page
  console.log('[FETCH] Downloading fixtures page...');
  const html = await fetchHtml(CONFIG.FIXTURE_URL);
  console.log(`[FETCH] ${html.length.toLocaleString()} bytes received.`);

  // 3. Parse fixtures
  const fixtures = parseFixtures(html, CONFIG.TEAM_NAME);
  console.log(`[PARSE] Found ${fixtures.length} fixture(s) for "${CONFIG.TEAM_NAME}".`);

  if (fixtures.length === 0) {
    console.warn('[WARN] No fixtures found. Check TEAM_NAME matches the site exactly, or the page HTML structure may have changed.');
    return;
  }

  // 4. Get existing managed events from Google Calendar
  console.log('[GCAL] Fetching existing managed events...');
  const existing = await listEvents(token, CONFIG.CALENDAR_ID);
  console.log(`[GCAL] ${existing.length} managed event(s) found.`);

  // Build lookup: fixtureId → Google Calendar event
  const existingMap = {};
  for (const ev of existing) {
    const fid = ev.extendedProperties?.private?.fixtureId;
    if (fid) existingMap[fid] = ev;
  }

  // 5. Sync
  let created = 0, deleted = 0, skipped = 0;

  // Create missing non-cancelled fixtures
  for (const fix of fixtures) {
    if (fix.cancelled) {
      if (existingMap[fix.fixtureId]) {
        await deleteEvent(token, CONFIG.CALENDAR_ID, existingMap[fix.fixtureId].id, fix.summary);
        deleted++;
      } else {
        console.log(`[SKIP] Cancelled, not in calendar: ${fix.summary}`);
        skipped++;
      }
    } else {
      if (existingMap[fix.fixtureId]) {
        console.log(`[SKIP] Already exists: ${fix.summary}`);
        skipped++;
      } else {
        await createEvent(token, CONFIG.CALENDAR_ID, fix);
        created++;
      }
    }
  }

  console.log(`\n[DONE] Created: ${created} | Deleted: ${deleted} | Skipped: ${skipped}`);
}

// ── Run ──────────────────────────────────────────────────────────────────────
validate();
sync().catch(err => {
  console.error(`[FATAL] ${err.message}`);
  if (CONFIG.DRY_RUN || CONFIG.DEBUG) console.error(err.stack);
  process.exit(1);
});
