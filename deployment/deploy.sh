#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.staging"
COMPOSE_FILE="${ROOT_DIR}/deployment/docker-compose.yml"

cd "${ROOT_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: Missing ${ENV_FILE}"
  echo "Copy .env.staging.example to .env.staging and configure it first."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -z "${POSTGRES_PASSWORD:-}" || "${POSTGRES_PASSWORD}" == "replace_with_a_long_random_password" ]]; then
  echo "ERROR: Configure POSTGRES_PASSWORD in .env.staging first."
  exit 1
fi

if [[ -z "${JWT_SECRET_KEY:-}" || "${JWT_SECRET_KEY}" == "replace_with_a_long_random_jwt_secret" ]]; then
  echo "ERROR: Configure JWT_SECRET_KEY in .env.staging first."
  exit 1
fi

BRANCH="${DEPLOY_BRANCH:-develop}"

echo "==> CodeStation Business OS deployment"
echo "==> Branch: ${BRANCH}"

git fetch origin "${BRANCH}"

if [[ "$(git branch --show-current)" != "${BRANCH}" ]]; then
  git checkout "${BRANCH}"
fi

git pull --ff-only origin "${BRANCH}"

echo "==> Building application images"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build

echo "==> Starting PostgreSQL"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d postgres

for attempt in $(seq 1 30); do
  if docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres \
    pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    break
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    echo "ERROR: PostgreSQL did not become ready in time."
    exit 1
  fi
  sleep 2
done

echo "==> Applying Alembic migrations"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm backend \
  uv run --no-sync alembic upgrade head

echo "==> Starting backend and frontend"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans backend frontend

echo "==> Waiting for backend health"
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8100/api/v1/health >/dev/null; then
    break
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    echo "ERROR: Backend health check failed."
    docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=100 backend
    exit 1
  fi
  sleep 2
done

echo "==> Waiting for frontend"
for attempt in $(seq 1 30); do
  if curl -fsI http://127.0.0.1:3100 >/dev/null; then
    break
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    echo "ERROR: Frontend health check failed."
    docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=100 frontend
    exit 1
  fi
  sleep 2
done

echo "==> Deployment status"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

echo "==> Deployment completed successfully"
echo "Frontend: https://os.codestationai.com"
echo "API:      https://api-os.codestationai.com"
