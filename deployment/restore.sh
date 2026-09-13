#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${BUSINESS_OS_ENV_FILE:-${ROOT_DIR}/.env.staging}"
COMPOSE_FILE="${ROOT_DIR}/deployment/docker-compose.yml"

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

usage() {
  cat <<'EOF'
Usage:
  sudo bash deployment/restore.sh <backup.tar.gz.enc> --verify
  RESTORE_CONFIRM=RESTORE_CODESTATION_BUSINESS_OS sudo -E bash deployment/restore.sh <backup.tar.gz.enc> --apply

--verify performs a full database restore into a temporary validation database and
validates the uploads archive without touching production data.

--apply first creates a fresh safety backup, stops application writers, replaces the
production database/uploads with the selected backup, restarts services, and runs
production verification. It requires the explicit RESTORE_CONFIRM value above.
EOF
}

[[ $# -ge 1 ]] || { usage; exit 2; }
backup_file="$1"
mode="${2:---verify}"
[[ "${mode}" == "--verify" || "${mode}" == "--apply" ]] || { usage; exit 2; }
[[ -f "${backup_file}" ]] || fail "Backup file not found: ${backup_file}"
[[ -f "${ENV_FILE}" ]] || fail "Missing ${ENV_FILE}"

POSTGRES_USER="$(env_value POSTGRES_USER)"
POSTGRES_DB="$(env_value POSTGRES_DB)"
BACKUP_ENCRYPTION_KEY="$(env_value BACKUP_ENCRYPTION_KEY)"
POSTGRES_USER="${POSTGRES_USER:-business_os}"
POSTGRES_DB="${POSTGRES_DB:-codestation_business_os}"

[[ "${POSTGRES_USER}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "POSTGRES_USER must be a safe PostgreSQL identifier"
[[ "${POSTGRES_DB}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "POSTGRES_DB must be a safe PostgreSQL identifier"
[[ -n "${BACKUP_ENCRYPTION_KEY}" ]] || fail "BACKUP_ENCRYPTION_KEY is not configured"
[[ "${BACKUP_ENCRYPTION_KEY}" != "replace_with_a_long_random_backup_encryption_key" ]] || fail "BACKUP_ENCRYPTION_KEY still uses the example placeholder"

COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

"${COMPOSE[@]}" up -d postgres >/dev/null
for attempt in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
    break
  fi
  [[ "${attempt}" -lt 30 ]] || fail "PostgreSQL did not become ready"
  sleep 2
done

checksum_file="${backup_file}.sha256"
if [[ -f "${checksum_file}" ]]; then
  echo "==> Verifying backup checksum"
  (
    cd "$(dirname "${backup_file}")"
    sha256sum -c "$(basename "${checksum_file}")"
  )
else
  echo "WARNING: checksum file is missing; continuing with encrypted archive validation" >&2
fi

work_dir="$(mktemp -d)"
scratch_db=""
cleanup() {
  if [[ -n "${scratch_db}" ]]; then
    "${COMPOSE[@]}" exec -T postgres dropdb -U "${POSTGRES_USER}" --if-exists "${scratch_db}" >/dev/null 2>&1 || true
  fi
  rm -rf "${work_dir}"
}
trap cleanup EXIT

bundle="${work_dir}/bundle.tar.gz"
extract_dir="${work_dir}/extract"
mkdir -p "${extract_dir}"

echo "==> Decrypting backup"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY}" openssl enc -d \
  -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "${backup_file}" -out "${bundle}"

tar -xzf "${bundle}" -C "${extract_dir}"
database_dump="${extract_dir}/database.dump"
uploads_archive="${extract_dir}/uploads.tar.gz"
manifest="${extract_dir}/manifest.txt"
[[ -f "${database_dump}" ]] || fail "Backup is missing database.dump"
[[ -f "${uploads_archive}" ]] || fail "Backup is missing uploads.tar.gz"
[[ -f "${manifest}" ]] || fail "Backup is missing manifest.txt"

"${COMPOSE[@]}" exec -T postgres pg_restore --list < "${database_dump}" >/dev/null
tar -tzf "${uploads_archive}" >/dev/null

echo "==> Verifying database restore in a disposable database"
scratch_db="business_os_restore_verify_$(date -u +%Y%m%d%H%M%S)_${RANDOM}"
"${COMPOSE[@]}" exec -T postgres createdb -U "${POSTGRES_USER}" "${scratch_db}"
"${COMPOSE[@]}" exec -T postgres pg_restore \
  -U "${POSTGRES_USER}" -d "${scratch_db}" --no-owner --no-privileges \
  < "${database_dump}"

restored_users_table="$(${COMPOSE[@]} exec -T postgres psql -U "${POSTGRES_USER}" -d "${scratch_db}" -Atc \
  "SELECT to_regclass('public.users') IS NOT NULL;" 2>/dev/null || true)"
if grep -q '^alembic_version=' "${manifest}" && ! grep -q '^alembic_version=uninitialized$' "${manifest}"; then
  [[ "${restored_users_table}" == "t" ]] || fail "Restored validation database is missing the users table"
fi

"${COMPOSE[@]}" exec -T postgres dropdb -U "${POSTGRES_USER}" --if-exists "${scratch_db}"
scratch_db=""
echo "Backup restore verification passed."

if [[ "${mode}" == "--verify" ]]; then
  exit 0
fi

[[ "${RESTORE_CONFIRM:-}" == "RESTORE_CODESTATION_BUSINESS_OS" ]] || \
  fail "--apply requires RESTORE_CONFIRM=RESTORE_CODESTATION_BUSINESS_OS"

echo "==> Creating a pre-restore safety backup"
bash "${ROOT_DIR}/deployment/backup.sh"

echo "==> Stopping application writers"
"${COMPOSE[@]}" stop backend frontend finance-scheduler >/dev/null || true

echo "==> Replacing production PostgreSQL database"
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER}" -d postgres \
  -v ON_ERROR_STOP=1 -v target_db="${POSTGRES_DB}" -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'target_db' AND pid <> pg_backend_pid();" >/dev/null
"${COMPOSE[@]}" exec -T postgres dropdb -U "${POSTGRES_USER}" --if-exists "${POSTGRES_DB}"
"${COMPOSE[@]}" exec -T postgres createdb -U "${POSTGRES_USER}" "${POSTGRES_DB}"
"${COMPOSE[@]}" exec -T postgres pg_restore \
  -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --no-privileges \
  < "${database_dump}"

echo "==> Replacing private uploads"
"${COMPOSE[@]}" run --rm --no-deps backend python -c \
  'from pathlib import Path; import shutil; root=Path("/data/uploads"); root.mkdir(parents=True, exist_ok=True); [(shutil.rmtree(p) if p.is_dir() and not p.is_symlink() else p.unlink()) for p in list(root.iterdir())]'
"${COMPOSE[@]}" run --rm --no-deps backend \
  sh -c 'mkdir -p /data/uploads && tar -xzf - -C /data/uploads' \
  < "${uploads_archive}"

echo "==> Restarting Business OS"
"${COMPOSE[@]}" up -d --remove-orphans backend frontend finance-scheduler

bash "${ROOT_DIR}/deployment/verify-production.sh" --quick

echo "Production restore completed successfully."
