#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.staging"
COMPOSE_FILE="${ROOT_DIR}/deployment/docker-compose.yml"
SCHEDULER_COMPOSE_FILE="${COMPOSE_FILE}"
PROJECT_NAME=""
NETWORK_NAME=""
UPLOADS_VOLUME="codestation-business-os_business_os_uploads"
STATE_DIR="/var/lib/codestation-business-os"
STATE_FILE="${STATE_DIR}/active-slot"
NGINX_SITE="/etc/nginx/sites-available/codestation-business-os"
NGINX_UPSTREAMS="/etc/nginx/conf.d/codestation-business-os-upstreams.conf"
NGINX_PROXY_MAP="/etc/nginx/conf.d/codestation-business-os-proxy-map.conf"
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

is_true() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

ensure_project_credential_key() {
  local current
  current="$(env_value PROJECT_CREDENTIAL_ENCRYPTION_KEY)"
  if [[ -z "${current}" || "${current}" == "replace_with_a_long_random_project_credential_key" || "${current}" == "development-only-project-credential-key" ]]; then
    echo "==> Generating project credential encryption key"
    local generated
    generated="$(openssl rand -hex 32)"
    if grep -q '^PROJECT_CREDENTIAL_ENCRYPTION_KEY=' "${ENV_FILE}"; then
      sed -i "s|^PROJECT_CREDENTIAL_ENCRYPTION_KEY=.*$|PROJECT_CREDENTIAL_ENCRYPTION_KEY=${generated}|" "${ENV_FILE}"
    else
      printf '\nPROJECT_CREDENTIAL_ENCRYPTION_KEY=%s\n' "${generated}" >> "${ENV_FILE}"
    fi
    unset generated
  fi
}

ensure_backup_encryption_key() {
  local current
  current="$(env_value BACKUP_ENCRYPTION_KEY)"
  if [[ -z "${current}" || "${current}" == "replace_with_a_long_random_backup_encryption_key" ]]; then
    echo "==> Generating backup encryption key"
    local generated
    generated="$(openssl rand -hex 32)"
    if grep -q '^BACKUP_ENCRYPTION_KEY=' "${ENV_FILE}"; then
      sed -i "s|^BACKUP_ENCRYPTION_KEY=.*$|BACKUP_ENCRYPTION_KEY=${generated}|" "${ENV_FILE}"
    else
      printf '\nBACKUP_ENCRYPTION_KEY=%s\n' "${generated}" >> "${ENV_FILE}"
    fi
    unset generated
  fi
}

validate_google_oauth_config() {
  local public_client_id backend_client_id
  public_client_id="$(env_value NEXT_PUBLIC_GOOGLE_CLIENT_ID)"
  backend_client_id="$(env_value GOOGLE_OAUTH_CLIENT_ID)"

  if [[ -z "${public_client_id}" || "${public_client_id}" == "replace_with_google_web_client_id.apps.googleusercontent.com" ]]; then
    echo "ERROR: Configure NEXT_PUBLIC_GOOGLE_CLIENT_ID in .env.staging before deployment."
    echo "The frontend Google sign-in button is compiled at build time and is hidden when this value is missing."
    exit 1
  fi

  if [[ -z "${backend_client_id}" || "${backend_client_id}" == "replace_with_google_web_client_id.apps.googleusercontent.com" ]]; then
    echo "ERROR: Configure GOOGLE_OAUTH_CLIENT_ID in .env.staging before deployment."
    exit 1
  fi

  if [[ "${public_client_id}" != "${backend_client_id}" ]]; then
    echo "ERROR: NEXT_PUBLIC_GOOGLE_CLIENT_ID and GOOGLE_OAUTH_CLIENT_ID must use the same Google Web OAuth client ID."
    exit 1
  fi
}

validate_account_email_config() {
  local smtp_host smtp_from smtp_username smtp_password
  smtp_host="$(env_value SMTP_HOST)"
  smtp_from="$(env_value SMTP_FROM_EMAIL)"
  smtp_username="$(env_value SMTP_USERNAME)"
  smtp_password="$(env_value SMTP_PASSWORD)"

  if [[ -z "${smtp_host}" || "${smtp_host}" == "smtp.example.com" ]]; then
    echo "ERROR: Configure SMTP_HOST in .env.staging before deployment."
    echo "Password signup, email verification and password recovery require account-email delivery."
    exit 1
  fi
  if [[ -z "${smtp_from}" || "${smtp_from}" != *@*.* ]]; then
    echo "ERROR: Configure a valid SMTP_FROM_EMAIL in .env.staging before deployment."
    exit 1
  fi
  if [[ "${smtp_username}" == "replace_with_smtp_username" || "${smtp_password}" == "replace_with_smtp_password" ]]; then
    echo "ERROR: Replace the example SMTP credentials in .env.staging."
    exit 1
  fi
  if [[ -n "${smtp_username}" && -z "${smtp_password}" ]] || [[ -z "${smtp_username}" && -n "${smtp_password}" ]]; then
    echo "ERROR: SMTP_USERNAME and SMTP_PASSWORD must either both be configured or both be empty for an unauthenticated relay."
    exit 1
  fi
}

validate_backup_config() {
  local remote_required remote_target backup_dir
  remote_required="$(env_value BACKUP_REMOTE_REQUIRED)"
  remote_target="$(env_value BACKUP_REMOTE_RSYNC_TARGET)"
  backup_dir="$(env_value BACKUP_DIR)"
  backup_dir="${backup_dir:-/var/backups/codestation-business-os}"

  if [[ "${backup_dir}" != /* ]]; then
    echo "ERROR: BACKUP_DIR must be an absolute path."
    exit 1
  fi
  if is_true "${remote_required:-false}" && [[ -z "${remote_target}" ]]; then
    echo "ERROR: BACKUP_REMOTE_REQUIRED=true but BACKUP_REMOTE_RSYNC_TARGET is empty."
    exit 1
  fi
}

ensure_nginx_upload_limit() {
  if [[ ! -f "${NGINX_SITE}" ]] || ! command -v nginx >/dev/null 2>&1; then
    return
  fi
  if grep -q '# codestation-business-os-upload-limit' "${NGINX_SITE}"; then
    return
  fi

  echo "==> Enabling 25 MB frontend document uploads in Business OS Nginx site"
  local backup="${NGINX_SITE}.pre-upload-limit"
  cp "${NGINX_SITE}" "${backup}"
  sed -i '/server_name os\.codestationai\.com;/a\    # codestation-business-os-upload-limit\n    client_max_body_size 25m;' "${NGINX_SITE}"

  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    rm -f "${backup}"
  else
    mv "${backup}" "${NGINX_SITE}"
    nginx -t
    echo "ERROR: Nginx upload-limit update failed and was rolled back."
    exit 1
  fi
}

ensure_nginx_client_ip_headers() {
  if [[ ! -f "${NGINX_SITE}" ]] || ! command -v nginx >/dev/null 2>&1; then
    return
  fi

  local backup="${NGINX_SITE}.pre-client-ip"
  cp "${NGINX_SITE}" "${backup}"

  # The Business OS host Nginx is the public ingress. Remove any stale copies,
  # then set one trusted client-IP header beside every X-Real-IP directive.
  # Also overwrite X-Forwarded-For at the edge so browser-supplied values cannot
  # become authoritative in security/audit logs.
  sed -i '/proxy_set_header X-Business-OS-Client-IP /d' "${NGINX_SITE}"
  sed -i 's|proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;|proxy_set_header X-Forwarded-For \$remote_addr;|g' "${NGINX_SITE}"
  sed -i '/proxy_set_header X-Real-IP \$remote_addr;/a\        proxy_set_header X-Business-OS-Client-IP $remote_addr;' "${NGINX_SITE}"

  if ! grep -q 'proxy_set_header X-Business-OS-Client-IP \$remote_addr;' "${NGINX_SITE}"; then
    mv "${backup}" "${NGINX_SITE}"
    echo "ERROR: Could not add trusted client-IP forwarding to Business OS Nginx site."
    exit 1
  fi

  if cmp -s "${backup}" "${NGINX_SITE}"; then
    rm -f "${backup}"
    return
  fi

  echo "==> Enabling trusted client IP forwarding in Business OS Nginx site"
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx
    rm -f "${backup}"
  else
    mv "${backup}" "${NGINX_SITE}"
    nginx -t
    echo "ERROR: Nginx client-IP update failed and was rolled back."
    exit 1
  fi
}

set_env_value() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "${ENV_FILE}"; then
    sed -i "s|^${key}=.*$|${key}=${value}|" "${ENV_FILE}"
  else
    printf "\n%s=%s\n" "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

project_has_state() {
  local project="$1"
  if docker ps -a \
      --filter "label=com.docker.compose.project=${project}" \
      --filter "label=com.docker.compose.service=postgres" \
      --format '{{.ID}}' | grep -q .; then
    return 0
  fi
  docker volume inspect "${project}_business_os_postgres" >/dev/null 2>&1
}

resolve_compose_project() {
  local configured candidate
  configured="$(env_value COMPOSE_PROJECT_NAME)"

  if [[ -n "${configured}" ]]; then
    [[ "${configured}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || fail "COMPOSE_PROJECT_NAME contains unsupported characters"
    PROJECT_NAME="${configured}"
    if ! project_has_state "${PROJECT_NAME}"; then
      for candidate in codestation-business-os deployment; do
        [[ "${candidate}" == "${PROJECT_NAME}" ]] && continue
        if project_has_state "${candidate}"; then
          fail "COMPOSE_PROJECT_NAME=${PROJECT_NAME} has no existing PostgreSQL state, but ${candidate} does. Refusing to risk switching to a different database volume."
        fi
      done
    fi
  else
    local found=""
    for candidate in codestation-business-os deployment; do
      if project_has_state "${candidate}"; then
        if [[ -n "${found}" ]]; then
          fail "Multiple Business OS PostgreSQL Compose projects were found (${found}, ${candidate}). Set COMPOSE_PROJECT_NAME explicitly in .env.staging before deploying."
        fi
        found="${candidate}"
      fi
    done
    PROJECT_NAME="${found:-codestation-business-os}"
    set_env_value COMPOSE_PROJECT_NAME "${PROJECT_NAME}"
  fi

  NETWORK_NAME="${PROJECT_NAME}_default"
  log "Docker Compose project: ${PROJECT_NAME}"
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
# Managed by CodeStation Business OS deploy.sh.
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

ensure_nginx_keepalive_headers() {
  [[ -f "${NGINX_SITE}" ]] || fail "Missing Nginx site ${NGINX_SITE}"

  local site_backup map_backup="" map_created="false"
  site_backup="$(mktemp)"
  cp "${NGINX_SITE}" "${site_backup}"

  if ! grep -Rqs 'map $http_upgrade $business_os_connection_upgrade' /etc/nginx; then
    if [[ -f "${NGINX_PROXY_MAP}" ]]; then
      map_backup="$(mktemp)"
      cp "${NGINX_PROXY_MAP}" "${map_backup}"
    else
      map_created="true"
    fi
    cat > "${NGINX_PROXY_MAP}" <<'EOF'
# Managed by CodeStation Business OS deploy.sh.
map $http_upgrade $business_os_connection_upgrade {
    default upgrade;
    ''      '';
}
EOF
    chmod 0644 "${NGINX_PROXY_MAP}"
  fi

  sed -i 's|proxy_set_header Connection "upgrade";|proxy_set_header Connection $business_os_connection_upgrade;|g' "${NGINX_SITE}"

  if nginx -t >/dev/null 2>&1; then
    if ! cmp -s "${site_backup}" "${NGINX_SITE}"; then
      log "Enabled conditional Nginx upgrade headers so normal HTTP can reuse upstream keepalive connections"
      systemctl reload nginx
    fi
    rm -f "${site_backup}" "${map_backup}"
    return 0
  fi

  cp "${site_backup}" "${NGINX_SITE}"
  if [[ -n "${map_backup}" ]]; then
    cp "${map_backup}" "${NGINX_PROXY_MAP}"
  elif [[ "${map_created}" == "true" ]]; then
    rm -f "${NGINX_PROXY_MAP}"
  fi
  rm -f "${site_backup}" "${map_backup}"
  nginx -t
  fail "Nginx keepalive header update failed and was rolled back"
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

active_backend_container() {
  local active="$1"
  local manual_name
  manual_name="$(slot_backend_name "${active}")"
  if docker inspect "${manual_name}" >/dev/null 2>&1; then
    printf '%s' "${manual_name}"
    return 0
  fi

  if [[ "${active}" == "blue" ]]; then
    local legacy_backend
    legacy_backend="$("${COMPOSE[@]}" ps -q backend 2>/dev/null || true)"
    if [[ -n "${legacy_backend}" ]] && docker inspect "${legacy_backend}" >/dev/null 2>&1; then
      printf '%s' "${legacy_backend}"
      return 0
    fi
  fi

  return 1
}

sync_active_uploads_to_volume() {
  local active="$1"
  local source_container
  source_container="$(active_backend_container "${active}" || true)"
  [[ -n "${source_container}" ]] || return 0

  local mounted_volume
  mounted_volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/uploads"}}{{.Name}}{{end}}{{end}}' "${source_container}" 2>/dev/null || true)"
  if [[ "${mounted_volume}" == "${UPLOADS_VOLUME}" ]]; then
    return 0
  fi

  if ! docker exec "${source_container}" sh -c 'test -d /data/uploads && test -n "$(find /data/uploads -mindepth 1 -print -quit 2>/dev/null)"' >/dev/null 2>&1; then
    return 0
  fi

  log "Preserving uploads from active ${active} backend into ${UPLOADS_VOLUME}"
  local helper_name="${PROJECT_NAME}-upload-seed-$$"
  docker rm -f "${helper_name}" >/dev/null 2>&1 || true
  docker create --name "${helper_name}" -v "${UPLOADS_VOLUME}:/data/uploads" postgres:17-alpine sh -c true >/dev/null
  if ! docker cp "${source_container}:/data/uploads/." "${helper_name}:/data/uploads/"; then
    docker rm -f "${helper_name}" >/dev/null 2>&1 || true
    fail "Could not preserve active uploads before candidate deployment"
  fi
  docker rm -f "${helper_name}" >/dev/null
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
    -e ENVIRONMENT=production \
    -e DATABASE_URL="${database_url}" \
    -v "${UPLOADS_VOLUME}:/data/uploads" \
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

restore_previous_scheduler() {
  local previous_image="$1"
  [[ -n "${previous_image}" ]] || return 1

  log "Restoring previous finance scheduler image"
  docker image tag "${previous_image}" "${PROJECT_NAME}-backend:latest" >/dev/null
  "${SCHEDULER_COMPOSE[@]}" up -d --no-deps --force-recreate finance-scheduler >/dev/null
}

[[ -f "${ENV_FILE}" ]] || fail "Missing ${ENV_FILE}"
[[ -f "${COMPOSE_FILE}" ]] || fail "Missing ${COMPOSE_FILE}"
[[ -f "${SCHEDULER_COMPOSE_FILE}" ]] || fail "Missing ${SCHEDULER_COMPOSE_FILE}"
for command_name in docker git curl nginx systemctl flock openssl; do
  command -v "${command_name}" >/dev/null 2>&1 || fail "${command_name} is required"
done

exec 9>"${LOCK_FILE}"
flock -n 9 || fail "Another Business OS deployment is already running"

if ! grep -q '^JWT_SECRET_KEY=' "${ENV_FILE}"; then
  echo "==> Generating JWT secret for this environment"
  printf '\nJWT_SECRET_KEY=%s\n' "$(openssl rand -hex 32)" >> "${ENV_FILE}"
elif grep -q '^JWT_SECRET_KEY=replace_with_a_long_random_jwt_secret$' "${ENV_FILE}"; then
  JWT_SECRET="$(openssl rand -hex 32)"
  sed -i "s|^JWT_SECRET_KEY=replace_with_a_long_random_jwt_secret$|JWT_SECRET_KEY=${JWT_SECRET}|" "${ENV_FILE}"
  unset JWT_SECRET
fi

ensure_project_credential_key
ensure_backup_encryption_key

if ! grep -q '^SUPER_ADMIN_EMAIL=' "${ENV_FILE}"; then
  printf '\nSUPER_ADMIN_EMAIL=admin@codestationai.com\n' >> "${ENV_FILE}"
fi

if ! grep -q '^SUPER_ADMIN_NAME=' "${ENV_FILE}"; then
  printf 'SUPER_ADMIN_NAME=CodeStation AI Super Admin\n' >> "${ENV_FILE}"
fi

if ! grep -q '^SUPER_ADMIN_PASSWORD=' "${ENV_FILE}"; then
  echo "==> Generating initial super admin password"
  printf 'SUPER_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> "${ENV_FILE}"
elif grep -q '^SUPER_ADMIN_PASSWORD=replace_with_a_long_random_super_admin_password$' "${ENV_FILE}"; then
  SUPER_ADMIN_PASSWORD="$(openssl rand -hex 24)"
  sed -i "s|^SUPER_ADMIN_PASSWORD=replace_with_a_long_random_super_admin_password$|SUPER_ADMIN_PASSWORD=${SUPER_ADMIN_PASSWORD}|" "${ENV_FILE}"
  unset SUPER_ADMIN_PASSWORD
fi

POSTGRES_USER="$(env_value POSTGRES_USER)"
POSTGRES_DB="$(env_value POSTGRES_DB)"
POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)"
POSTGRES_USER="${POSTGRES_USER:-business_os}"
POSTGRES_DB="${POSTGRES_DB:-codestation_business_os}"

if [[ -z "${POSTGRES_PASSWORD}" || "${POSTGRES_PASSWORD}" == "replace_with_a_long_random_password" ]]; then
  fail "Configure POSTGRES_PASSWORD in .env.staging first."
fi

resolve_compose_project
mkdir -p "${STATE_DIR}"
chmod 700 "${STATE_DIR}"

if ! docker volume inspect "${UPLOADS_VOLUME}" >/dev/null 2>&1; then
  log "Creating persistent upload volume ${UPLOADS_VOLUME}"
  docker volume create "${UPLOADS_VOLUME}" >/dev/null
fi

COMPOSE=(docker compose -p "${PROJECT_NAME}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")
SCHEDULER_COMPOSE=(docker compose -p "${PROJECT_NAME}" --env-file "${ENV_FILE}" -f "${SCHEDULER_COMPOSE_FILE}")

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

branch="${DEPLOY_BRANCH:-develop}"
git fetch origin "${branch}"
if [[ "$(git branch --show-current)" != "${branch}" ]]; then
  git checkout "${branch}"
fi
git pull --ff-only origin "${branch}"

# Re-apply idempotent bootstrap/config guards after fast-forwarding the release.
ensure_project_credential_key
ensure_backup_encryption_key
ensure_nginx_upload_limit
ensure_nginx_client_ip_headers
validate_google_oauth_config
validate_account_email_config
validate_backup_config

BUSINESS_OS_ENV_FILE="${ENV_FILE}" bash "${ROOT_DIR}/deployment/verify-production.sh" --config-only
"${COMPOSE[@]}" config -q
"${SCHEDULER_COMPOSE[@]}" config -q

log "Ensuring PostgreSQL is available"
"${COMPOSE[@]}" up -d postgres
for attempt in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U "$(env_value POSTGRES_USER)" -d "$(env_value POSTGRES_DB)" >/dev/null 2>&1; then
    break
  fi
  [[ "${attempt}" -lt 30 ]] || fail "PostgreSQL did not become ready"
  sleep 2
done

# Older blue/green candidates stored uploads inside their container filesystem.
# Merge that active data into the stable named volume before any inactive slot is
# removed. Existing volume content is preserved; active files only add/overwrite
# matching paths, so this is backward-compatible with older Compose deployments.
sync_active_uploads_to_volume "${active_slot}"

remove_legacy_blue_if_inactive "${active_slot}"
remove_manual_slot "${candidate_slot}"

previous_scheduler_id="$("${SCHEDULER_COMPOSE[@]}" ps -q finance-scheduler 2>/dev/null || true)"
previous_scheduler_image=""
if [[ -n "${previous_scheduler_id}" ]]; then
  previous_scheduler_image="$(docker inspect -f '{{.Image}}' "${previous_scheduler_id}" 2>/dev/null || true)"
fi

log "Building candidate images while active release stays online"
"${COMPOSE[@]}" build backend frontend
backend_image="$(docker image inspect "${PROJECT_NAME}-backend:latest" --format '{{.Id}}' 2>/dev/null || true)"
frontend_image="$(docker image inspect "${PROJECT_NAME}-frontend:latest" --format '{{.Id}}' 2>/dev/null || true)"
[[ -n "${backend_image}" ]] || fail "Could not resolve newly built backend image"
[[ -n "${frontend_image}" ]] || fail "Could not resolve newly built frontend image"

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

write_upstreams "${active_slot}"
ensure_nginx_named_upstreams
ensure_nginx_keepalive_headers

log "Running candidate smoke checks before traffic switch"
wait_url "http://127.0.0.1:$(slot_backend_port "${candidate_slot}")/api/v1/health" "candidate API smoke check"
wait_url "http://127.0.0.1:$(slot_frontend_port "${candidate_slot}")/login" "candidate frontend smoke check"

log "Refreshing singleton finance scheduler from candidate backend image"
if ! "${SCHEDULER_COMPOSE[@]}" up -d --no-deps --force-recreate finance-scheduler; then
  restore_previous_scheduler "${previous_scheduler_image}" || true
  remove_manual_slot "${candidate_slot}"
  fail "Finance scheduler could not be refreshed; active ${active_slot} release was not switched"
fi

scheduler_id=""
for attempt in $(seq 1 10); do
  scheduler_id="$("${SCHEDULER_COMPOSE[@]}" ps -q finance-scheduler 2>/dev/null || true)"
  if [[ -n "${scheduler_id}" ]] \
    && [[ "$(docker inspect -f '{{.State.Running}}' "${scheduler_id}" 2>/dev/null || true)" == "true" ]]; then
    break
  fi
  sleep 1
done
if [[ -z "${scheduler_id}" ]] \
  || [[ "$(docker inspect -f '{{.State.Running}}' "${scheduler_id}" 2>/dev/null || true)" != "true" ]]; then
  [[ -z "${scheduler_id}" ]] || docker logs --tail=120 "${scheduler_id}" || true
  restore_previous_scheduler "${previous_scheduler_image}" || true
  remove_manual_slot "${candidate_slot}"
  fail "Finance scheduler did not stay running; active ${active_slot} release was not switched"
fi

log "Switching Nginx traffic atomically to ${candidate_slot}"
if ! write_upstreams "${candidate_slot}"; then
  write_upstreams "${active_slot}" || true
  restore_previous_scheduler "${previous_scheduler_image}" || true
  remove_manual_slot "${candidate_slot}"
  fail "Nginx traffic switch failed; ${active_slot} remains active"
fi

if ! wait_url "https://api-os.codestationai.com/api/v1/health" "public API" 15 \
  || ! wait_url "https://os.codestationai.com/login" "public frontend" 15; then
  echo "ERROR: Public verification failed; rolling traffic back to ${active_slot}." >&2
  write_upstreams "${active_slot}" || true
  restore_previous_scheduler "${previous_scheduler_image}" || true
  remove_manual_slot "${candidate_slot}"
  exit 1
fi

printf '%s\n' "${candidate_slot}" > "${STATE_FILE}"
chmod 600 "${STATE_FILE}"

log "Installing daily encrypted backup timer"
if ! BUSINESS_OS_ENV_FILE="${ENV_FILE}" bash "${ROOT_DIR}/deployment/install-backup-timer.sh"; then
  echo "ERROR: Backup timer installation failed; rolling traffic back to ${active_slot}." >&2
  printf '%s\n' "${active_slot}" > "${STATE_FILE}"
  chmod 600 "${STATE_FILE}"
  write_upstreams "${active_slot}" || true
  restore_previous_scheduler "${previous_scheduler_image}" || true
  remove_manual_slot "${candidate_slot}"
  exit 1
fi

log "Running production quick verification"
if ! BUSINESS_OS_ENV_FILE="${ENV_FILE}" bash "${ROOT_DIR}/deployment/verify-production.sh" --quick; then
  echo "ERROR: Production verification failed; rolling traffic back to ${active_slot}." >&2
  printf '%s\n' "${active_slot}" > "${STATE_FILE}"
  chmod 600 "${STATE_FILE}"
  write_upstreams "${active_slot}" || true
  restore_previous_scheduler "${previous_scheduler_image}" || true
  remove_manual_slot "${candidate_slot}"
  exit 1
fi

log "Deployment completed successfully"
log "Active slot is now ${candidate_slot}"
log "Previous ${active_slot} release remains online as Nginx backup/rollback slot"
echo "Frontend: https://os.codestationai.com"
echo "API:      https://api-os.codestationai.com"
echo "Store BACKUP_ENCRYPTION_KEY separately in a secure password manager."
