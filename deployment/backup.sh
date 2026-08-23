#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${BUSINESS_OS_ENV_FILE:-${ROOT_DIR}/.env.staging}"
COMPOSE_FILE="${BUSINESS_OS_COMPOSE_FILE:-${ROOT_DIR}/deployment/docker-compose.yml}"

cd "${ROOT_DIR}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
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

[[ -f "${ENV_FILE}" ]] || fail "Missing ${ENV_FILE}"
[[ -f "${COMPOSE_FILE}" ]] || fail "Missing ${COMPOSE_FILE}"
command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v openssl >/dev/null 2>&1 || fail "openssl is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"

POSTGRES_USER="$(env_value POSTGRES_USER)"
POSTGRES_DB="$(env_value POSTGRES_DB)"
BACKUP_DIR="$(env_value BACKUP_DIR)"
BACKUP_RETENTION_DAYS="$(env_value BACKUP_RETENTION_DAYS)"
BACKUP_ENCRYPTION_KEY="$(env_value BACKUP_ENCRYPTION_KEY)"
BACKUP_REMOTE_RSYNC_TARGET="$(env_value BACKUP_REMOTE_RSYNC_TARGET)"
BACKUP_REMOTE_REQUIRED="$(env_value BACKUP_REMOTE_REQUIRED)"

POSTGRES_USER="${POSTGRES_USER:-business_os}"
POSTGRES_DB="${POSTGRES_DB:-codestation_business_os}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/codestation-business-os}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_REMOTE_REQUIRED="${BACKUP_REMOTE_REQUIRED:-false}"

[[ "${BACKUP_DIR}" == /* ]] || fail "BACKUP_DIR must be an absolute path"
[[ "${BACKUP_RETENTION_DAYS}" =~ ^[0-9]+$ ]] || fail "BACKUP_RETENTION_DAYS must be a non-negative integer"
[[ -n "${BACKUP_ENCRYPTION_KEY}" ]] || fail "BACKUP_ENCRYPTION_KEY is not configured"
[[ "${BACKUP_ENCRYPTION_KEY}" != "replace_with_a_long_random_backup_encryption_key" ]] || fail "BACKUP_ENCRYPTION_KEY still uses the example placeholder"

if is_true "${BACKUP_REMOTE_REQUIRED}" && [[ -z "${BACKUP_REMOTE_RSYNC_TARGET}" ]]; then
  fail "BACKUP_REMOTE_REQUIRED=true but BACKUP_REMOTE_RSYNC_TARGET is empty"
fi

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

if ! "${COMPOSE[@]}" exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
  fail "PostgreSQL is not running/ready; backup was not created"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
work_dir="$(mktemp -d "${BACKUP_DIR}/.business-os-${timestamp}.XXXXXX")"
cleanup() {
  rm -rf "${work_dir}"
}
trap cleanup EXIT

database_dump="${work_dir}/database.dump"
uploads_archive="${work_dir}/uploads.tar.gz"
manifest="${work_dir}/manifest.txt"
bundle="${work_dir}/bundle.tar.gz"
backup_file="${BACKUP_DIR}/business-os-${timestamp}.tar.gz.enc"
checksum_file="${backup_file}.sha256"

echo "==> Backing up PostgreSQL"
"${COMPOSE[@]}" exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc --no-owner --no-privileges \
  > "${database_dump}"

# Validate that the custom-format dump can be read before encrypting it.
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "${database_dump}" >/dev/null

echo "==> Backing up private uploads"
"${COMPOSE[@]}" run --rm --no-deps backend \
  sh -c 'mkdir -p /data/uploads && tar -czf - -C /data/uploads .' \
  > "${uploads_archive}"
tar -tzf "${uploads_archive}" >/dev/null

migration_version="uninitialized"
has_alembic="$(${COMPOSE[@]} exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atc \
  "SELECT to_regclass('public.alembic_version') IS NOT NULL;" 2>/dev/null || true)"
if [[ "${has_alembic}" == "t" ]]; then
  migration_version="$(${COMPOSE[@]} exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atc \
    "SELECT version_num FROM alembic_version LIMIT 1;" 2>/dev/null || printf 'unknown')"
fi

git_commit="$(git rev-parse HEAD 2>/dev/null || printf 'unknown')"
cat > "${manifest}" <<EOF
created_at_utc=${timestamp}
git_commit=${git_commit}
alembic_version=${migration_version}
postgres_database=${POSTGRES_DB}
uploads_path=/data/uploads
format=codestation-business-os-v1
EOF

tar -czf "${bundle}" -C "${work_dir}" database.dump uploads.tar.gz manifest.txt

echo "==> Encrypting backup"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY}" openssl enc \
  -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "${bundle}" -out "${backup_file}"

sha256sum "${backup_file}" > "${checksum_file}"
chmod 600 "${backup_file}" "${checksum_file}"

echo "==> Validating encrypted backup"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY}" openssl enc \
  -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "${backup_file}" -out "${work_dir}/validation-bundle.tar.gz"
tar -tzf "${work_dir}/validation-bundle.tar.gz" >/dev/null

if [[ -n "${BACKUP_REMOTE_RSYNC_TARGET}" ]]; then
  if command -v rsync >/dev/null 2>&1; then
    echo "==> Copying encrypted backup off-server"
    if ! rsync -a --protect-args "${backup_file}" "${checksum_file}" "${BACKUP_REMOTE_RSYNC_TARGET}"; then
      if is_true "${BACKUP_REMOTE_REQUIRED}"; then
        fail "Remote backup copy failed and BACKUP_REMOTE_REQUIRED=true"
      fi
      echo "WARNING: Remote backup copy failed; local encrypted backup remains available."
    fi
  elif is_true "${BACKUP_REMOTE_REQUIRED}"; then
    fail "rsync is required because BACKUP_REMOTE_REQUIRED=true"
  else
    echo "WARNING: rsync is not installed; skipping optional remote backup copy."
  fi
fi

if (( BACKUP_RETENTION_DAYS > 0 )); then
  find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'business-os-*.tar.gz.enc' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
  find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'business-os-*.tar.gz.enc.sha256' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
fi

echo "Backup created: ${backup_file}"
echo "Checksum:       ${checksum_file}"
