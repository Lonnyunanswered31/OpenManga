#!/usr/bin/env bash
# Backup: Postgres custom-format dump + asset volume archive + configuration (secrets stay out of git; backups/ is ignored).
# Usage: scripts/backup.sh [backup-root]   (default ./backups)   KEEP=7 retention by default.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="${1:-./backups}"
KEEP="${KEEP:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$ROOT/$STAMP"
PROJECT="$(docker compose config --format json 2>/dev/null | sed -n 's/^ *"name": "\(.*\)",$/\1/p' | head -1)"
PROJECT="${PROJECT:-openmanga}"
mkdir -p "$DEST"
chmod 700 "$DEST"

set -a
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
set +a
PGUSER="${POSTGRES_USER:-openmanga}"
PGDB="${POSTGRES_DB:-openmanga}"

echo "==> Dumping PostgreSQL ($PGDB)"
docker compose exec -T postgres pg_dump -U "$PGUSER" -d "$PGDB" -Fc --no-owner > "$DEST/postgres.dump"

echo "==> Archiving asset volume"
docker run --rm -v "${PROJECT}_assets-data:/data:ro" -v "$(realpath "$DEST"):/backup" alpine:3.20 \
  sh -c 'tar czf /backup/assets.tar.gz -C /data . && chown '"$(id -u):$(id -g)"' /backup/assets.tar.gz'

echo "==> Saving configuration"
cp docker-compose.yml "$DEST/"
[ -f docker-compose.dev.yml ] && cp docker-compose.dev.yml "$DEST/"
[ -f .env ] && install -m 600 .env "$DEST/env.backup"
cp -r deploy "$DEST/deploy"

( cd "$DEST" && sha256sum postgres.dump assets.tar.gz > SHA256SUMS )
echo "{\"createdAt\":\"$STAMP\",\"project\":\"$PROJECT\",\"database\":\"$PGDB\"}" > "$DEST/manifest.json"

echo "==> Retention: keeping last $KEEP backups"
ls -1dt "$ROOT"/*/ 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -rf

du -sh "$DEST"
echo "Backup complete: $DEST"
