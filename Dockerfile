FROM node:20-alpine

LABEL maintainer="ha-fixture-sync"
LABEL description="Syncs football fixtures from a league website into a Home Assistant calendar"

WORKDIR /app

# No npm dependencies — pure Node.js stdlib only
COPY src/ ./src/

# Healthcheck: verify the process is still running
HEALTHCHECK --interval=5m --timeout=10s --start-period=30s \
  CMD pgrep -f entrypoint.js || exit 1

# Environment variable defaults (all overridable at runtime)
ENV HA_URL=""
ENV HA_USERNAME=""
ENV HA_PASSWORD=""
ENV HA_TOKEN=""
ENV CALENDAR="calendar.fixtures"
ENV FIXTURE_URL=""
ENV TEAM_NAME=""
ENV UPDATE_FREQUENCY="360"
ENV DRY_RUN="false"
ENV DEBUG="false"

ENTRYPOINT ["node", "/app/src/entrypoint.js"]
