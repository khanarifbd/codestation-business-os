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

container_running() {
  local name="$1"
  [[ "$(docker inspect -f '{{.State.Running}}' "${name}" 2>/dev/null || true)" == "true" ]]
}

merge_container_legacy_uploads() {
  local container="$1"

  docker inspect "${container}" >/dev/null 2>&1 || return 0
  container_running "${container}" || return 0

  local mounted_volume
  mounted_volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/uploads"}}{{.Name}}{{end}}{{end}}' "${container}" 2>/dev/null || true)"
  [[ "${mounted_volume}" == "${UPLOADS_VOLUME}" ]] || \
    fail "${container} does not mount ${UPLOADS_VOLUME} at ${PERSISTENT_PATH}"

  if ! docker exec "${container}" sh -c \
    'test -d /app/data/uploads && test -n "$(find /app/data/uploads -type f -print -quit 2>/dev/null)"'; then
    log "${container}: no legacy files in ${LEGACY_PATH}"
    return 0
  fi

  local legacy_files persistent_before persistent_after
  legacy_files="$(docker exec "${container}" sh -c 'find /app/data/uploads -type f 2>/dev/null | wc -l | tr -d " "')"
  persistent_before="$(docker exec "${container}" sh -c 'find /data/uploads -type f 2>/dev/null | wc -l | tr -d " "')"

  log "${container}: preserving ${legacy_files} legacy file(s) into ${UPLOADS_VOLUME}"
  # Uploaded objects use generated storage keys and are immutable after creation.
  # Never overwrite a file already present in the persistent volume; this lets us
  # safely merge legacy data from both blue and green rollback containers.
  docker exec "${container}" sh -c \
    'mkdir -p /data/uploads && cp -an /app/data/uploads/. /data/uploads/ && sync'

  persistent_after="$(docker exec "${container}" sh -c 'find /data/uploads -type f 2>/dev/null | wc -l | tr -d " "')"
  log "${container}: persistent upload files ${persistent_before} -> ${persistent_after}"
}

command -v docker >/dev/null 2>&1 || fail "docker is required"
[[ -f "${STATE_FILE}" ]] || fail "Active-slot state file is missing: ${STATE_FILE}"

active_slot="$(tr -d '[:space:]' < "${STATE_FILE}")"
[[ "${active_slot}" == "blue" || "${active_slot}" == "green" ]] || \
  fail "Invalid active slot: ${active_slot}"

active_backend="${PROJECT_NAME}-${active_slot}-backend"
container_running "${active_backend}" || fail "Active backend is not running: ${active_backend}"

# Merge both slots before the next blue/green candidate is removed. An older
# rollback slot can contain uploads that were written to its disposable layer.
merge_container_legacy_uploads "${PROJECT_NAME}-blue-backend"
merge_container_legacy_uploads "${PROJECT_NAME}-green-backend"

log "Legacy upload recovery completed. Source files were intentionally left in place; no data was deleted."
