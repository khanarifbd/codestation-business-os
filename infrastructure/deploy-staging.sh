#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env.staging ]]; then
  echo "Missing .env.staging. Copy .env.staging.example and set the real domains first."
  exit 1
fi

BRANCH="$(git branch --show-current)"

echo "Deploying branch: ${BRANCH}"
git pull --ff-only origin "$BRANCH"

docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --build

docker compose --env-file .env.staging -f docker-compose.staging.yml ps
