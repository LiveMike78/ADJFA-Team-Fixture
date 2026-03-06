# ⚽ ADJFA Team Fixture

[![Build & Push Docker Image](https://github.com/YOUR_USERNAME/adjfa-team-fixture/actions/workflows/docker.yml/badge.svg)](https://github.com/YOUR_USERNAME/adjfa-team-fixture/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Docker Image](https://img.shields.io/badge/ghcr.io-the--gaffer-blue?logo=docker)](https://github.com/YOUR_USERNAME/adjfa-team-fixture/pkgs/container/adjfa-team-fixture)

A lightweight Docker container that scrapes a football league fixtures page and syncs matches directly into **Google Calendar** — creating new fixtures, skipping duplicates, and **automatically deleting** cancelled or postponed ones.

- ✅ Zero npm dependencies — pure Node.js standard library
- ✅ Full create **and delete** via the Google Calendar API
- ✅ Deduplication — won't create the same fixture twice
- ✅ Cancellation detection — automatically removes postponed/cancelled fixtures
- ✅ Service Account auth — no browser login, runs headlessly forever
- ✅ Multi-arch Docker image (`amd64` + `arm64`)

---

## Prerequisites

- A **Google Cloud project** with the [Google Calendar API enabled](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
- A **Service Account** with a JSON key (see [Google Cloud Setup](#google-cloud-setup) below)
- A **Google Calendar** shared with the service account
- **Docker** (with Compose) on your host

---

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/adjfa-team-fixture.git
cd adjfa-team-fixture
cp .env.example .env
# Edit .env with your values
docker compose up -d
```

View logs:

```bash
docker compose logs -f
```

---

## Google Cloud Setup

### 1. Enable the Calendar API

In your existing Google Cloud project:

[APIs & Services → Library → Google Calendar API → Enable](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)

### 2. Create a Service Account

**IAM & Admin → Service Accounts → Create Service Account**

- Give it a name (e.g. `adjfa-team-fixture`  or any name you like)
- No roles needed at project level — click through to finish

### 3. Create a JSON Key

**Service Accounts → [your account] → Keys → Add Key → Create new key → JSON**

Download the `.json` file. You'll paste its contents as the `GOOGLE_SERVICE_ACCOUNT_JSON` env var (as a single line).

### 4. Share your calendar with the service account

In **Google Calendar** on the web:

**Settings → [Your Calendar] → Share with specific people → Add person**

Enter the service account's email address (format: `name@project.iam.gserviceaccount.com`) and grant **"Make changes to events"** permission.

### 5. Get your Calendar ID

**Google Calendar → Settings → [Your Calendar] → Calendar ID**

It looks like `abc123@group.calendar.google.com` or your Gmail address for the primary calendar.

---

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ✅ | — | Full contents of the service account JSON key (single line) |
| `CALENDAR_ID` | ✅ | — | Google Calendar ID to sync into |
| `FIXTURE_URL` | ✅ | — | URL of the league fixtures page |
| `TEAM_NAME` | ✅ | — | Team name exactly as it appears on the page |
| `UPDATE_FREQUENCY` | ❌ | `360` | How often to sync, in minutes |
| `DRY_RUN` | ❌ | `false` | Log what would happen without making any changes |
| `DEBUG` | ❌ | `false` | Verbose error stack traces |

---

## How It Works

On each run the container:

1. **Authenticates** with Google using a JWT signed with the service account private key
2. **Fetches** the configured fixture page HTML
3. **Parses** all table rows containing the team name
4. **Lists** existing managed events from Google Calendar (identified by a `managedBy=adjfa-team-fixture` extended property)
5. **Creates** any fixture not already present
6. **Skips** fixtures already in the calendar
7. **Deletes** any fixture marked as cancelled or postponed

Cancellation keywords: `cancel`, `postpone`, `void`, `called off`, `P.P.`

Events created by adjfa-team-fixture are tagged with a private extended property (`managedBy=adjfa-team-fixture` + `fixtureId`) so the container only ever touches events it created — it will never modify anything you've added manually.

---

## Debugging

Run a one-shot dry run to verify the parser is picking up fixtures correctly without touching your calendar:

```bash
docker run --rm \
  --env-file .env \
  -e DRY_RUN=true \
  -e DEBUG=true \
  ghcr.io/YOUR_USERNAME/adjfa-team-fixture:latest
```

The parser logs the raw cell array from the first matching table row — use this to verify the column layout matches the site's HTML.

**No fixtures found?** Check that `TEAM_NAME` exactly matches the text on the page (copy-paste it). The comparison is case-insensitive but must be an exact substring match.

---

## Using a Pre-Built Image

The CI workflow automatically builds and publishes a multi-arch image to GitHub Container Registry on every push to `main`. To use it without building locally, `docker-compose.yml` is already configured to pull it:

```bash
docker compose pull
docker compose up -d
```

---

## Project Structure

```
adjfa-team-fixture/
├── .github/
│   ├── workflows/
│   │   └── docker.yml              # CI: build & push multi-arch image to GHCR
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.md
│       └── feature_request.md
├── src/
│   ├── entrypoint.js               # Scheduler — runs sync on configured interval
│   └── sync.js                     # Core: fetch → parse → diff → Google Calendar
├── .env.example                    # Template — copy to .env and fill in values
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── LICENSE
└── README.md
```

---

## Contributing

Issues and PRs welcome. Please open an issue first for significant changes.

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit and push
4. Open a Pull Request

---

## Publishing to GitHub

After cloning and filling in your details:

```bash
# Replace YOUR_USERNAME with your GitHub username in:
#   README.md, docker-compose.yml, .github/workflows/docker.yml

git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/adjfa-team-fixture.git
git push -u origin main
```

The CI workflow will fire and publish the Docker image to GHCR automatically.

---

## License

[MIT](LICENSE)
