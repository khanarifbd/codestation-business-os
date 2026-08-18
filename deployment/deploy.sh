#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.staging"
COMPOSE_FILE="${ROOT_DIR}/deployment/docker-compose.yml"
NGINX_SITE="/etc/nginx/sites-available/codestation-business-os"

cd "${ROOT_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: Missing ${ENV_FILE}"
  echo "Copy .env.staging.example to .env.staging and configure it first."
  exit 1
fi

# Read only the values the deployment script needs. Do not source the whole
# dotenv file because valid dotenv values may contain spaces.
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
  echo "ERROR: Configure POSTGRES_PASSWORD in .env.staging first."
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

# Run again after pull so newly deployed bootstrap logic applies on this release.
ensure_project_credential_key
ensure_backup_encryption_key
ensure_nginx_upload_limit
validate_google_oauth_config
validate_account_email_config
validate_backup_config

# Centralized configuration verification catches placeholder/unsafe launch values
# without printing any secrets to deployment logs.
bash "${ROOT_DIR}/deployment/verify-production.sh" --config-only

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

# Always preserve a recoverable encrypted snapshot before schema migrations.
echo "==> Creating pre-migration encrypted backup"
BUSINESS_OS_ENV_FILE="${ENV_FILE}" bash "${ROOT_DIR}/deployment/backup.sh"

echo "==> Applying Alembic migrations"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" run --rm backend \
  uv run --no-sync alembic upgrade head

echo "==> Starting backend, frontend and finance scheduler"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans \
  backend frontend finance-scheduler

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

if ! docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T backend \
  sh -c 'test -n "${PROJECT_CREDENTIAL_ENCRYPTION_KEY:-}" && test "${PROJECT_CREDENTIAL_ENCRYPTION_KEY}" != "development-only-project-credential-key"'; then
  echo "ERROR: Credentials Vault encryption key is not available inside the backend container."
  exit 1
fi

echo "==> Waiting for frontend"
for attempt in $(seq 1 30); do
  if curl -fsI http://127.0.0.1:3100/login >/dev/null; then
    break
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    echo "ERROR: Frontend health check failed."
    docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=100 frontend
    exit 1
  fi
  sleep 2
done

if ! docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps --status running --services | grep -qx 'finance-scheduler'; then
  echo "ERROR: finance-scheduler is not running."
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=100 finance-scheduler
  exit 1
fi

echo "==> Installing daily encrypted backup timer"
BUSINESS_OS_ENV_FILE="${ENV_FILE}" bash "${ROOT_DIR}/deployment/install-backup-timer.sh"

echo "==> Running production quick verification"
BUSINESS_OS_ENV_FILE="${ENV_FILE}" bash "${ROOT_DIR}/deployment/verify-production.sh" --quick

echo "==> Deployment status"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

echo "==> Deployment completed successfully"
echo "Frontend: https://os.codestationai.com"
echo "API:      https://api-os.codestationai.com"
echo "Super admin, encryption and backup keys are stored in .env.staging"
echo "Store BACKUP_ENCRYPTION_KEY separately in a secure password manager before relying on disaster recovery."
