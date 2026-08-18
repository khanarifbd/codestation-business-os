#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${BUSINESS_OS_ENV_FILE:-${ROOT_DIR}/.env.staging}"
SERVICE_FILE="/etc/systemd/system/codestation-business-os-backup.service"
TIMER_FILE="/etc/systemd/system/codestation-business-os-backup.timer"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: install-backup-timer.sh must run as root." >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "ERROR: systemd is required to install the backup timer." >&2
  exit 1
fi

if [[ "${ROOT_DIR}" == *$'\n'* || "${ENV_FILE}" == *$'\n'* ]]; then
  echo "ERROR: Invalid deployment path." >&2
  exit 1
fi

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=CodeStation AI Business OS encrypted backup
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${ROOT_DIR}
Environment=BUSINESS_OS_ENV_FILE=${ENV_FILE}
ExecStart=/usr/bin/env bash ${ROOT_DIR}/deployment/backup.sh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF

cat > "${TIMER_FILE}" <<'EOF'
[Unit]
Description=Daily CodeStation AI Business OS backup

[Timer]
OnCalendar=*-*-* 02:30:00
RandomizedDelaySec=15m
Persistent=true
Unit=codestation-business-os-backup.service

[Install]
WantedBy=timers.target
EOF

chmod 644 "${SERVICE_FILE}" "${TIMER_FILE}"
systemctl daemon-reload
systemctl enable --now codestation-business-os-backup.timer >/dev/null

echo "Backup timer installed and enabled: codestation-business-os-backup.timer"
