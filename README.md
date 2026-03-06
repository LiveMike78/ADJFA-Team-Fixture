# ⚽ ha-fixture-sync

[![Build & Push Docker Image](https://github.com/YOUR_USERNAME/ha-fixture-sync/actions/workflows/docker.yml/badge.svg)](https://github.com/YOUR_USERNAME/ha-fixture-sync/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Docker Image](https://img.shields.io/badge/ghcr.io-ha--fixture--sync-blue?logo=docker)](https://github.com/YOUR_USERNAME/ha-fixture-sync/pkgs/container/ha-fixture-sync)

A lightweight Docker container that scrapes a football league fixtures page and automatically syncs matches into a **Home Assistant Local Calendar** — adding new fixtures on each run and alerting you to cancellations/postponements.

- ✅ Zero npm dependencies — pure Node.js standard library
- ✅ Deduplication — won't create the same fixture twice
- ✅ Cancellation detection — sends a persistent HA notification when a fixture is postponed/cancelled
- ✅ Configurable via environment variables
- ✅ Multi-arch Docker image (`amd64` + `arm64`)

---

## Prerequisites

- **Home Assistant** with the [Local Calendar integration](https://www.home-assistant.io/integrations/local_calendar/) enabled
- **Docker** (with Compose) on your host

---

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/ha-fixture-sync.git
cd ha-fixture-sync
cp .env.example .env
```

Edit `.env` with your values (see [Configuration](#configuration) below), then:

```bash
docker compose up -d
```

View logs:

```bash
docker compose logs -f
```

---

## Home Assistant Setup

### 1. Create a Local Calendar

**Settings → Integrations → Add Integration → Local Calendar**

Give it a name (e.g. *Blackburn FC*). The entity ID will be something like `calendar.blackburn_fc` — note this for the `CALENDAR` env var.

### 2. Generate a Long-Lived Access Token

**HA → Your Profile (bottom-left) → Long-Lived Access Tokens → Create Token**

Copy it immediately — you won't see it again. Use it as your `HA_TOKEN`.

---

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `HA_URL` | ✅ | — | Your HA URL, e.g. `http://192.168.1.10:8123` |
| `HA_TOKEN` | ✅ * | — | Long-lived access token (recommended) |
| `HA_USERNAME` | ✅ * | — | HA username (legacy — needs enabling in HA) |
| `HA_PASSWORD` | ✅ * | — | HA password |
| `CALENDAR` | ✅ | `calendar.fixtures` | Entity ID of the target Local Calendar |
| `FIXTURE_URL` | ✅ | — | Full URL of the league fixtures page |
| `TEAM_NAME` | ✅ | — | Team name exactly as it appears on the page |
| `UPDATE_FREQUENCY` | ❌ | `360` | Sync interval in minutes (360 = every 6 hours) |
| `DRY_RUN` | ❌ | `false` | Log actions without making any changes |
| `DEBUG` | ❌ | `false` | Verbose error stack traces |

\* Either `HA_TOKEN` **or** `HA_USERNAME` + `HA_PASSWORD` required.

---

## How It Works

On each run the container:

1. **Fetches** the configured fixture page
2. **Parses** all table rows that contain the team name
3. **Fetches** existing events from the HA calendar (next 365 days)
4. **Adds** any fixture not already present (deduplication by match title + date)
5. **Skips** fixtures already in the calendar
6. **Notifies** via HA persistent notification for any fixture detected as cancelled or postponed

### Cancellation detection

Keywords that trigger a cancellation alert: `cancel`, `postpone`, `void`, `called off`, `P.P.`

> **Why not delete the event automatically?**
> Home Assistant's Local Calendar integration does not expose a `delete_event` or `update_event` API service. When a cancellation is detected, the container sends a persistent notification in HA so you can remove the event manually.
>
> Advanced users with file system access to the HA host can edit the `.ics` file directly:
> ```
> /config/.storage/local_calendar/<calendar_name>/calendar.ics
> ```

---

## Using a Pre-Built Image

Once you've pushed to GitHub, the CI workflow automatically builds and publishes a multi-arch image to GitHub Container Registry on every push to `main`. You can then use it directly without building:

```yaml
# docker-compose.yml
services:
  ha-fixture-sync:
    image: ghcr.io/YOUR_USERNAME/ha-fixture-sync:latest
    restart: unless-stopped
    env_file: .env
```

---

## Debugging

Run a one-shot dry run to verify the parser is picking up fixtures correctly without touching your calendar:

```bash
docker run --rm \
  --env-file .env \
  -e DRY_RUN=true \
  -e DEBUG=true \
  ghcr.io/YOUR_USERNAME/ha-fixture-sync:latest
```

The parser logs the raw cell array from the first matching table row — this lets you verify the column layout matches the fixture site's HTML structure.

**No fixtures found?** Check that `TEAM_NAME` matches the page exactly (copy-paste from the site). The match is case-insensitive but must be an exact substring.

---

## Project Structure

```
ha-fixture-sync/
├── .github/
│   ├── workflows/
│   │   └── docker.yml          # CI: build & push multi-arch image to GHCR
│   └── ISSUE_TEMPLATE/
│       ├── bug_report.md
│       └── feature_request.md
├── src/
│   ├── entrypoint.js           # Scheduler — runs sync on configured interval
│   └── sync.js                 # Core logic: fetch → parse → diff → sync
├── .env.example                # Template — copy to .env and fill in values
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
3. Commit your changes
4. Push and open a Pull Request

---

## License

[MIT](LICENSE)
