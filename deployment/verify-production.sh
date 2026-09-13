#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${BUSINESS_OS_ENV_FILE:-${ROOT_DIR}/.env.staging}"
COMPOSE_FILE="${ROOT_DIR}/deployment/docker-compose.yml"
MODE="${1:---quick}"

cd "${ROOT_DIR}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

warn() {
  echo "WARNING: $*" >&2
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

require_real_value() {
  local key="$1"
  local value placeholder
  value="$(env_value "${key}")"
  placeholder="${2:-}"
  [[ -n "${value}" ]] || fail "${key} is not configured in ${ENV_FILE}"
  if [[ -n "${placeholder}" && "${value}" == "${placeholder}" ]]; then
    fail "${key} still uses the example placeholder"
  fi
}

[[ "${MODE}" == "--config-only" || "${MODE}" == "--quick" || "${MODE}" == "--full" ]] || \
  fail "Usage: verify-production.sh [--config-only|--quick|--full]"
[[ -f "${ENV_FILE}" ]] || fail "Missing ${ENV_FILE}"

require_real_value POSTGRES_PASSWORD replace_with_a_long_random_password
require_real_value JWT_SECRET_KEY replace_with_a_long_random_jwt_secret
require_real_value PROJECT_CREDENTIAL_ENCRYPTION_KEY replace_with_a_long_random_project_credential_key
require_real_value BACKUP_ENCRYPTION_KEY replace_with_a_long_random_backup_encryption_key
require_real_value NEXT_PUBLIC_GOOGLE_CLIENT_ID replace_with_google_web_client_id.apps.googleusercontent.com
require_real_value GOOGLE_OAUTH_CLIENT_ID replace_with_google_web_client_id.apps.googleusercontent.com
require_real_value SMTP_HOST smtp.example.com
require_real_value SMTP_FROM_EMAIL

public_google="$(env_value NEXT_PUBLIC_GOOGLE_CLIENT_ID)"
backend_google="$(env_value GOOGLE_OAUTH_CLIENT_ID)"
[[ "${public_google}" == "${backend_google}" ]] || fail "Frontend/backend Google OAuth client IDs do not match"

public_app_url="$(env_value PUBLIC_APP_URL)"
public_api_url="$(env_value NEXT_PUBLIC_API_URL)"
[[ "${public_app_url}" == https://* ]] || fail "PUBLIC_APP_URL must use HTTPS for live/staging"
[[ "${public_api_url}" == https://* ]] || fail "NEXT_PUBLIC_API_URL must use HTTPS for live/staging"

smtp_from="$(env_value SMTP_FROM_EMAIL)"
[[ "${smtp_from}" == *@*.* ]] || fail "SMTP_FROM_EMAIL is not a valid-looking email address"
smtp_username="$(env_value SMTP_USERNAME)"
smtp_password="$(env_value SMTP_PASSWORD)"
if [[ -n "${smtp_username}" && -z "${smtp_password}" ]]; then
  fail "SMTP_USERNAME is configured but SMTP_PASSWORD is empty"
fi
if [[ -z "${smtp_username}" && -n "${smtp_password}" ]]; then
  fail "SMTP_PASSWORD is configured but SMTP_USERNAME is empty"
fi
[[ "${smtp_username}" != "replace_with_smtp_username" ]] || fail "SMTP_USERNAME still uses the example placeholder"
[[ "${smtp_password}" != "replace_with_smtp_password" ]] || fail "SMTP_PASSWORD still uses the example placeholder"

backup_remote_required="$(env_value BACKUP_REMOTE_REQUIRED)"
backup_remote_target="$(env_value BACKUP_REMOTE_RSYNC_TARGET)"
if is_true "${backup_remote_required:-false}" && [[ -z "${backup_remote_target}" ]]; then
  fail "BACKUP_REMOTE_REQUIRED=true but BACKUP_REMOTE_RSYNC_TARGET is empty"
fi

if [[ "${MODE}" == "--config-only" ]]; then
  echo "Production configuration verification passed."
  exit 0
fi

COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

for service in postgres backend frontend finance-scheduler; do
  if ! "${COMPOSE[@]}" ps --status running --services | grep -qx "${service}"; then
    fail "Docker service is not running: ${service}"
  fi
done

for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8100/api/v1/health >/dev/null; then
    break
  fi
  [[ "${attempt}" -lt 30 ]] || fail "Backend health check failed"
  sleep 2
done

for attempt in $(seq 1 30); do
  if curl -fsI http://127.0.0.1:3100/login >/dev/null; then
    break
  fi
  [[ "${attempt}" -lt 30 ]] || fail "Frontend health check failed"
  sleep 2
done

if ! "${COMPOSE[@]}" exec -T backend sh -c 'uv run --no-sync alembic current' | grep -q '(head)'; then
  fail "Database is not at the current Alembic head"
fi

BACKUP_DIR="$(env_value BACKUP_DIR)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/codestation-business-os}"
latest_backup="$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'business-os-*.tar.gz.enc' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2- || true)"
[[ -n "${latest_backup}" ]] || fail "No encrypted Business OS backup exists in ${BACKUP_DIR}"
if ! find "${latest_backup}" -mmin -2160 -print -quit | grep -q .; then
  fail "Latest backup is older than 36 hours: ${latest_backup}"
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl is-enabled codestation-business-os-backup.timer >/dev/null 2>&1 || fail "Backup systemd timer is not enabled"
  systemctl is-active codestation-business-os-backup.timer >/dev/null 2>&1 || fail "Backup systemd timer is not active"
else
  warn "systemctl is unavailable; backup timer state could not be checked"
fi

if [[ "${MODE}" == "--full" ]]; then
  smtp_host="$(env_value SMTP_HOST)"
  smtp_port="$(env_value SMTP_PORT)"
  smtp_port="${smtp_port:-587}"
  echo "==> Checking SMTP network reachability"
  "${COMPOSE[@]}" exec -T backend python -c \
    'import socket,sys; host=sys.argv[1]; port=int(sys.argv[2]); s=socket.create_connection((host,port), 10); s.close()' \
    "${smtp_host}" "${smtp_port}"

  echo "==> Performing full disposable restore drill"
  bash "${ROOT_DIR}/deployment/restore.sh" "${latest_backup}" --verify
fi

echo "Production verification passed (${MODE})."
