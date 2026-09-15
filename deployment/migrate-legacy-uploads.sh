#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

PROJECT_NAME="codestation-business-os"
STATE_FILE="/var/lib/codestation-business-os/active-slot"
UPLOADS_VOLUME="${PROJECT_NAME}_business_os_uploads"
LEGACY_PATH="/app/data/uploads"
PERSISTENT_PATH="/data/uploads"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

log() {
  echo "==> $*"
}

command -v docker >/dev/null 2>&1 || fail "docker is required"
[[ -f "${STATE_FILE}" ]] || fail "Active-slot state file is missing: ${STATE_FILE}"

active_slot="$(tr -d '[:space:]' < "${STATE_FILE}")"
[[ "${active_slot}" == "blue" || "${active_slot}" == "green" ]] || \
  fail "Invalid active slot: ${active_slot}"

backend_container="${PROJECT_NAME}-${active_slot}-backend"
docker inspect "${backend_container}" >/dev/null 2>&1 || \
  fail "Active backend container not found: ${backend_container}"

[[ "$(docker inspect -f '{{.State.Running}}' "${backend_container}")" == "true" ]] || \
  fail "Active backend is not running: ${backend_container}"

mounted_volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/uploads"}}{{.Name}}{{end}}{{end}}' "${backend_container}" 2>/dev/null || true)"
[[ "${mounted_volume}" == "${UPLOADS_VOLUME}" ]] || \
  fail "${backend_container} does not mount ${UPLOADS_VOLUME} at ${PERSISTENT_PATH}"

if ! docker exec "${backend_container}" sh -c \
  'test -d /app/data/uploads && test -n "$(find /app/data/uploads -mindepth 1 -print -quit 2>/dev/null)"'; then
  log "No legacy uploads found in ${LEGACY_PATH}; persistent volume is already the only storage location"
  exit 0
fi

legacy_files="$(docker exec "${backend_container}" sh -c 'find /app/data/uploads -type f 2>/dev/null | wc -l | tr -d " "')"
persistent_before="$(docker exec "${backend_container}" sh -c 'find /data/uploads -type f 2>/dev/null | wc -l | tr -d " "')"

log "Migrating ${legacy_files} legacy file(s) from ${LEGACY_PATH} to persistent volume ${UPLOADS_VOLUME}"
docker exec "${backend_container}" sh -c \
  'mkdir -p /data/uploads && cp -a /app/data/uploads/. /data/uploads/ && sync'

persistent_after="$(docker exec "${backend_container}" sh -c 'find /data/uploads -type f 2>/dev/null | wc -l | tr -d " "')"

log "Persistent upload files: ${persistent_before} -> ${persistent_after}"
log "Migration completed. Legacy files were intentionally left in place; no source data was deleted."
