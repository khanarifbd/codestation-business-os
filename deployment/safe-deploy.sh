#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.staging"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.staging.yml"
PROJECT_NAME="codestation-business-os"
NETWORK_NAME="${PROJECT_NAME}_default"
STATE_DIR="/var/lib/codestation-business-os"
STATE_FILE="${STATE_DIR}/active-slot"
NGINX_SITE="/etc/nginx/sites-available/codestation-business-os"
NGINX_UPSTREAMS="/etc/nginx/conf.d/codestation-business-os-upstreams.conf"
LOCK_FILE="/var/lock/codestation-business-os-deploy.lock"

BLUE_BACKEND_PORT=8100
BLUE_FRONTEND_PORT=3100
GREEN_BACKEND_PORT=8101
GREEN_FRONTEND_PORT=3101

cd "${ROOT_DIR}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

log() {
  echo "==> $*"
}

env_value() {
  local key="$1"
  local line
  line="$(grep -E "^${key}=" "${ENV_FILE}" | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}

wait_url() {
  local url="$1"
  local label="$2"
  local attempts="${3:-40}"
  for attempt in $(seq 1 "${attempts}"); do
    if curl -fsS --max-time 4 "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "ERROR: ${label} did not become healthy: ${url}" >&2
  return 1
}

slot_backend_port() {
  [[ "$1" == "blue" ]] && printf '%s' "${BLUE_BACKEND_PORT}" || printf '%s' "${GREEN_BACKEND_PORT}"
}

slot_frontend_port() {
  [[ "$1" == "blue" ]] && printf '%s' "${BLUE_FRONTEND_PORT}" || printf '%s' "${GREEN_FRONTEND_PORT}"
}

other_slot() {
  [[ "$1" == "blue" ]] && printf 'green' || printf 'blue'
}

slot_backend_name() {
  printf '%s-%s-backend' "${PROJECT_NAME}" "$1"
}

slot_frontend_name() {
  printf '%s-%s-frontend' "${PROJECT_NAME}" "$1"
}

write_upstreams() {
  local active="$1"
  local standby
  standby="$(other_slot "${active}")"
  local active_backend active_frontend standby_backend standby_frontend
  active_backend="$(slot_backend_port "${active}")"
  active_frontend="$(slot_frontend_port "${active}")"
  standby_backend="$(slot_backend_port "${standby}")"
  standby_frontend="$(slot_frontend_port "${standby}")"

  local tmp
  tmp="$(mktemp)"
  cat > "${tmp}" <<EOF
# Managed by CodeStation Business OS safe-deploy.sh.
# Active slot: ${active}
upstream business_os_backend {
    server 127.0.0.1:${active_backend} max_fails=1 fail_timeout=2s;
    server 127.0.0.1:${standby_backend} backup;
    keepalive 32;
}

upstream business_os_frontend {
    server 127.0.0.1:${active_frontend} max_fails=1 fail_timeout=2s;
    server 127.0.0.1:${standby_frontend} backup;
    keepalive 32;
}
EOF

  local backup=""
  if [[ -f "${NGINX_UPSTREAMS}" ]]; then
    backup="$(mktemp)"
    cp "${NGINX_UPSTREAMS}" "${backup}"
  fi
  install -m 0644 "${tmp}" "${NGINX_UPSTREAMS}"
  rm -f "${tmp}"

  if ! nginx -t >/dev/null 2>&1; then
    if [[ -n "${backup}" ]]; then
      cp "${backup}" "${NGINX_UPSTREAMS}"
    else
      rm -f "${NGINX_UPSTREAMS}"
    fi
    rm -f "${backup}"
    nginx -t
    return 1
  fi
  rm -f "${backup}"
  systemctl reload nginx
}

ensure_nginx_named_upstreams() {
  [[ -f "${NGINX_SITE}" ]] || fail "Missing Nginx site ${NGINX_SITE}"
  command -v nginx >/dev/null 2>&1 || fail "nginx is required"

  if grep -q 'proxy_pass http://business_os_frontend;' "${NGINX_SITE}" \
    && grep -q 'proxy_pass http://business_os_backend;' "${NGINX_SITE}"; then
    return 0
  fi

  log "Enabling Nginx blue-green upstreams"
  local backup
  backup="$(mktemp)"
  cp "${NGINX_SITE}" "${backup}"

  sed -i \
    -e 's|proxy_pass http://127\.0\.0\.1:3100;|proxy_pass http://business_os_frontend;|g' \
    -e 's|proxy_pass http://127\.0\.0\.1:8100;|proxy_pass http://business_os_backend;|g' \
    "${NGINX_SITE}"

  if ! grep -q 'proxy_pass http://business_os_frontend;' "${NGINX_SITE}" \
    || ! grep -q 'proxy_pass http://business_os_backend;' "${NGINX_SITE}"; then
    cp "${backup}" "${NGINX_SITE}"
    rm -f "${backup}"
    fail "Could not convert Nginx site to named Business OS upstreams"
  fi

  if ! nginx -t >/dev/null 2>&1; then
    cp "${backup}" "${NGINX_SITE}"
    rm -f "${backup}"
    nginx -t
    fail "Nginx blue-green configuration failed and was rolled back"
  fi
  rm -f "${backup}"
  systemctl reload nginx
}

remove_manual_slot() {
  local slot="$1"
  docker rm -f "$(slot_frontend_name "${slot}")" >/dev/null 2>&1 || true
  docker rm -f "$(slot_backend_name "${slot}")" >/dev/null 2>&1 || true
}

remove_legacy_blue_if_inactive() {
  local active="$1"
  [[ "${active}" == "green" ]] || return 0

  local legacy_frontend legacy_backend
  legacy_frontend="$("${COMPOSE[@]}" ps -q frontend 2>/dev/null || true)"
  legacy_backend="$("${COMPOSE[@]}" ps -q backend 2>/dev/null || true)"
  if [[ -n "${legacy_frontend}" || -n "${legacy_backend}" ]]; then
    log "Removing inactive legacy blue app containers"
    "${COMPOSE[@]}" stop frontend backend >/dev/null 2>&1 || true
    "${COMPOSE[@]}" rm -f frontend backend >/dev/null 2>&1 || true
  fi
}

start_candidate() {
  local slot="$1"
  local backend_image="$2"
  local frontend_image="$3"
  local backend_port frontend_port backend_name frontend_name
  backend_port="$(slot_backend_port "${slot}")"
  frontend_port="$(slot_frontend_port "${slot}")"
  backend_name="$(slot_backend_name "${slot}")"
  frontend_name="$(slot_frontend_name "${slot}")"

  remove_manual_slot "${slot}"

  local postgres_user postgres_password postgres_db database_url
  postgres_user="$(env_value POSTGRES_USER)"
  postgres_password="$(env_value POSTGRES_PASSWORD)"
  postgres_db="$(env_value POSTGRES_DB)"
  postgres_user="${postgres_user:-business_os}"
  postgres_db="${postgres_db:-codestation_business_os}"
  [[ -n "${postgres_password}" ]] || fail "POSTGRES_PASSWORD is missing"
  database_url="postgresql+psycopg://${postgres_user}:${postgres_password}@postgres:5432/${postgres_db}"

  log "Starting ${slot} backend candidate on 127.0.0.1:${backend_port}"
  docker run -d \
    --name "${backend_name}" \
    --network "${NETWORK_NAME}" \
    --restart unless-stopped \
    --env-file "${ENV_FILE}" \
    -e ENVIRONMENT=staging \
    -e DATABASE_URL="${database_url}" \
    -p "127.0.0.1:${backend_port}:8000" \
    "${backend_image}" >/dev/null

  if ! wait_url "http://127.0.0.1:${backend_port}/api/v1/health" "${slot} backend candidate"; then
    docker logs --tail=120 "${backend_name}" || true
    return 1
  fi

  log "Starting ${slot} frontend candidate on 127.0.0.1:${frontend_port}"
  docker run -d \
    --name "${frontend_name}" \
    --network "${NETWORK_NAME}" \
    --restart unless-stopped \
    -e INTERNAL_API_URL="http://${backend_name}:8000/api/v1" \
    -p "127.0.0.1:${frontend_port}:3000" \
    "${frontend_image}" >/dev/null

  if ! wait_url "http://127.0.0.1:${frontend_port}/login" "${slot} frontend candidate"; then
    docker logs --tail=120 "${frontend_name}" || true
    return 1
  fi
}

[[ -f "${ENV_FILE}" ]] || fail "Missing ${ENV_FILE}"
[[ -f "${COMPOSE_FILE}" ]] || fail "Missing ${COMPOSE_FILE}"
for command_name in docker git curl nginx systemctl flock; do
  command -v "${command_name}" >/dev/null 2>&1 || fail "${command_name} is required"
done

exec 9>"${LOCK_FILE}"
flock -n 9 || fail "Another Business OS deployment is already running"

mkdir -p "${STATE_DIR}"
chmod 700 "${STATE_DIR}"

COMPOSE=(docker compose -p "${PROJECT_NAME}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

active_slot="blue"
if [[ -f "${STATE_FILE}" ]]; then
  saved_slot="$(tr -d '[:space:]' < "${STATE_FILE}")"
  if [[ "${saved_slot}" == "blue" || "${saved_slot}" == "green" ]]; then
    active_slot="${saved_slot}"
  fi
fi
candidate_slot="$(other_slot "${active_slot}")"

log "CodeStation Business OS safe deployment"
log "Active slot: ${active_slot}; candidate slot: ${candidate_slot}"

# Pulling/building never stops the active release.
branch="${DEPLOY_BRANCH:-develop}"
git fetch origin "${branch}"
if [[ "$(git branch --show-current)" != "${branch}" ]]; then
  git checkout "${branch}"
fi
git pull --ff-only origin "${branch}"

"${COMPOSE[@]}" config -q

log "Ensuring PostgreSQL is available"
"${COMPOSE[@]}" up -d postgres
for attempt in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U "$(env_value POSTGRES_USER)" -d "$(env_value POSTGRES_DB)" >/dev/null 2>&1; then
    break
  fi
  [[ "${attempt}" -lt 30 ]] || fail "PostgreSQL did not become ready"
  sleep 2
done

# If the inactive blue slot is still the original Compose app, it is safe to
# remove only after green is the recorded active release.
remove_legacy_blue_if_inactive "${active_slot}"
remove_manual_slot "${candidate_slot}"

log "Building candidate images while active release stays online"
"${COMPOSE[@]}" build backend frontend
backend_image="$(docker image inspect "${PROJECT_NAME}-backend:latest" --format '{{.Id}}' 2>/dev/null || true)"
frontend_image="$(docker image inspect "${PROJECT_NAME}-frontend:latest" --format '{{.Id}}' 2>/dev/null || true)"
[[ -n "${backend_image}" ]] || fail "Could not resolve newly built backend image"
[[ -n "${frontend_image}" ]] || fail "Could not resolve newly built frontend image"

# A failed migration leaves the active release untouched. Migrations deployed by
# this workflow must be backward-compatible with the currently active app
# (expand-first; destructive contract changes belong in a later release).
log "Creating encrypted pre-migration backup"
BUSINESS_OS_ENV_FILE="${ENV_FILE}" BUSINESS_OS_COMPOSE_FILE="${COMPOSE_FILE}" \
  bash "${ROOT_DIR}/deployment/backup.sh"

log "Applying backward-compatible Alembic migrations"
"${COMPOSE[@]}" run --rm backend uv run --no-sync alembic upgrade head

log "Starting and validating candidate release"
if ! start_candidate "${candidate_slot}" "${backend_image}" "${frontend_image}"; then
  remove_manual_slot "${candidate_slot}"
  fail "Candidate failed health checks; active ${active_slot} release was not switched"
fi

# Configure named upstreams only after both active and candidate endpoints exist.
write_upstreams "${active_slot}"
ensure_nginx_named_upstreams

log "Running candidate smoke checks before traffic switch"
wait_url "http://127.0.0.1:$(slot_backend_port "${candidate_slot}")/api/v1/health" "candidate API smoke check"
wait_url "http://127.0.0.1:$(slot_frontend_port "${candidate_slot}")/login" "candidate frontend smoke check"

log "Switching Nginx traffic atomically to ${candidate_slot}"
if ! write_upstreams "${candidate_slot}"; then
  write_upstreams "${active_slot}" || true
  remove_manual_slot "${candidate_slot}"
  fail "Nginx traffic switch failed; ${active_slot} remains active"
fi

# Verify through the public ingress after the graceful Nginx reload. If this
# fails, point traffic back to the previous slot immediately.
if ! wait_url "https://api-os.codestationai.com/api/v1/health" "public API" 15 \
  || ! wait_url "https://os.codestationai.com/login" "public frontend" 15; then
  echo "ERROR: Public verification failed; rolling traffic back to ${active_slot}." >&2
  write_upstreams "${active_slot}" || true
  remove_manual_slot "${candidate_slot}"
  exit 1
fi

printf '%s\n' "${candidate_slot}" > "${STATE_FILE}"
chmod 600 "${STATE_FILE}"

log "Deployment completed successfully"
log "Active slot is now ${candidate_slot}"
log "Previous ${active_slot} release remains online as Nginx backup/rollback slot"
echo "Frontend: https://os.codestationai.com"
echo "API:      https://api-os.codestationai.com"
