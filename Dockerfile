FROM node:22-bookworm-slim

WORKDIR /app

# Two build-time needs, both removed again afterwards:
#   python3/make/g++ — better-sqlite3 is a native module
#   git              — baileys pulls libsignal straight from a git URL, and
#                      without it npm fails with a bare "spawn git ENOENT"
#                      that looks nothing like a missing package
COPY package.json ./
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
 && npm install --omit=dev --no-audit --no-fund \
 && apt-get purge -y python3 make g++ git \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
ENV DB_PATH=/data/sh.db
# The WhatsApp session. On the volume, never in the image — rebuilding must
# not force the phone to link the device again.
ENV AUTH_DIR=/data/auth
# The roster lives on the volume too, so adding a student is a file copy
# rather than a rebuild.
ENV STUDENTS_CSV=/data/students.csv

# Bound to localhost inside the container and not published. It exists only so
# Docker can tell whether the process is alive.
ENV HEALTH_PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
