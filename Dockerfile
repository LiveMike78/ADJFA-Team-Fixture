FROM node:20-alpine

LABEL org.opencontainers.image.title="ADJFA Team Fixture"
LABEL org.opencontainers.image.description="Football fixture → Google Calendar sync"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /app

# No npm dependencies — pure Node.js stdlib only
COPY src/ ./src/

HEALTHCHECK --interval=5m --timeout=10s --start-period=30s \
  CMD pgrep -f entrypoint.js || exit 1

ENV GOOGLE_SERVICE_ACCOUNT_JSON=""
ENV CALENDAR_ID=""
ENV FIXTURE_URL=""
ENV TEAM_NAME=""
ENV UPDATE_FREQUENCY="360"
ENV DRY_RUN="false"
ENV DEBUG="false"

ENTRYPOINT ["node", "/app/src/entrypoint.js"]
