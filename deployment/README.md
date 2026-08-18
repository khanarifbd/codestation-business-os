# Deployment

This folder is the canonical server/deployment layer for CodeStation Business OS.

## Contents

- `deploy.sh` — one-command staging/live-test deployment
- `docker-compose.yml` — PostgreSQL, FastAPI, recurring finance scheduler, and Next.js services
- `backup.sh` — encrypted PostgreSQL + private-upload backup with retention and optional off-server rsync
- `restore.sh` — safe restore verification and explicit disaster-recovery restore
- `install-backup-timer.sh` — installs/enables the daily systemd backup timer
- `verify-production.sh` — launch configuration/runtime verification and optional full restore drill
- `nginx/codestation-business-os.conf` — source Nginx reverse-proxy configuration

## Staging / first live-test server

- Frontend: `https://os.codestationai.com`
- API: `https://api-os.codestationai.com`
- Frontend local bind: `127.0.0.1:3100`
- Backend local bind: `127.0.0.1:8100`
- PostgreSQL is only exposed inside the Docker network.

## Persistent data

Docker named volumes persist database and document data across normal image rebuilds/container recreation:

- `business_os_postgres` — PostgreSQL data
- `business_os_uploads` — private company document uploads (`/data/uploads` in the backend container)

Named volumes are persistence, not disaster-recovery backups. `backup.sh` separately creates an encrypted archive containing a PostgreSQL custom-format dump, private uploads archive, and a manifest with the deployed Git commit/Alembic version.

Company files are not exposed as a public static directory. Authenticated tenant routes stream them after membership/role validation. The storage service is adapter-based so local VPS storage can later be replaced by S3/R2 without changing the company document database contract.

## One-command deploy

The staging/live-test server tracks the `develop` branch. From the repository root:

```bash
sudo bash deployment/deploy.sh
```

The script:

1. ensures JWT, Credentials Vault, backup-encryption, and platform super-admin bootstrap secrets exist
2. fetches and fast-forwards `develop`
3. validates Google OAuth, SMTP account-email delivery, backup configuration, and HTTPS public URLs
4. safely ensures the Business OS frontend Nginx site accepts up to 25 MB requests
5. builds backend/frontend/scheduler images
6. starts/waits for PostgreSQL
7. creates an encrypted pre-migration database + uploads backup
8. runs `alembic upgrade head`
9. starts backend, frontend, and `finance-scheduler`
10. installs/enables the daily encrypted backup timer
11. checks backend/frontend/scheduler, Alembic head, backup freshness, and timer state
12. prints container status

A deployment fails instead of silently continuing when required launch email/OAuth/backup configuration is still using example placeholders.

## Account email / SMTP

Password signup now requires email verification and password recovery uses email. Before deployment configure a real SMTP relay in `.env.staging`:

```text
SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_USERNAME=<username-or-empty-for-trusted-relay>
SMTP_PASSWORD=<password-or-empty-for-trusted-relay>
SMTP_FROM_EMAIL=no-reply@codestationai.com
SMTP_FROM_NAME=CodeStation AI Business OS
SMTP_USE_STARTTLS=true
SMTP_USE_SSL=false
```

`deployment/verify-production.sh --full` also checks that the configured SMTP host/port is reachable from the backend container. It does not send a real message; a real signup/recovery email should still be included in the live-test checklist.

## Encrypted backups

Important backup values in `.env.staging`:

```text
BACKUP_ENCRYPTION_KEY=<secure-random-key>
BACKUP_DIR=/var/backups/codestation-business-os
BACKUP_RETENTION_DAYS=14
BACKUP_REMOTE_RSYNC_TARGET=
BACKUP_REMOTE_REQUIRED=false
```

`deploy.sh` generates `BACKUP_ENCRYPTION_KEY` when missing/placeholder. Store that key separately outside the VPS (for example in a secure password manager). Losing both the VPS and this key makes encrypted backups unusable.

Create a backup manually:

```bash
sudo bash deployment/backup.sh
```

A systemd timer runs the same backup daily at approximately 02:30 server time (`RandomizedDelaySec=15m`, `Persistent=true`). Check it with:

```bash
systemctl status codestation-business-os-backup.timer
systemctl list-timers codestation-business-os-backup.timer
```

For an off-server encrypted copy, configure root/system service SSH access and set, for example:

```text
BACKUP_REMOTE_RSYNC_TARGET=backup-user@backup-host:/srv/backups/codestation-business-os
BACKUP_REMOTE_REQUIRED=true
```

Keep `BACKUP_REMOTE_REQUIRED=false` only while the first internal live test intentionally uses local-only backup. Before external customer data is onboarded, configure/test an off-server target and switch it to `true` so a failed remote copy makes the backup timer/deployment visibly fail.

## Restore verification and disaster recovery

Verify an encrypted backup without touching production data:

```bash
sudo bash deployment/restore.sh /var/backups/codestation-business-os/business-os-YYYYMMDDTHHMMSSZ.tar.gz.enc --verify
```

Verification checks the checksum/decryption/uploads archive and performs a real PostgreSQL restore into a disposable validation database, then removes it.

A full operational verification runs the latest restore drill plus SMTP reachability:

```bash
sudo bash deployment/verify-production.sh --full
```

Run this after the first live deployment and periodically (for example monthly).

Actual production restore is intentionally explicit and destructive. It first creates a fresh safety backup, stops application writers, replaces the production database/uploads, restarts all services, and runs quick verification:

```bash
RESTORE_CONFIRM=RESTORE_CODESTATION_BUSINESS_OS \
  sudo -E bash deployment/restore.sh /path/to/backup.tar.gz.enc --apply
```

Never use `--apply` merely to test a backup; use `--verify`.

## Secrets

`.env.staging` lives at the repository root and is not committed. It contains PostgreSQL, JWT, SMTP, Google OAuth, super-admin, Credentials Vault, and backup secrets.

Important platform values:

```text
SUPER_ADMIN_EMAIL=admin@codestationai.com
SUPER_ADMIN_PASSWORD=<secure-random-password>
SUPER_ADMIN_NAME=CodeStation AI Super Admin
```

If the super-admin values are absent, `deploy.sh` adds the default platform email/name and generates a secure random password. The password is not printed to deployment logs. It remains in `.env.staging`.

Generate secure values manually when needed with:

```bash
openssl rand -hex 32
```

## Nginx / SSL

The live Nginx file is managed by the server under `/etc/nginx/sites-available/`. The repository copy is the source/template for disaster recovery and future server moves. Certbot manages the HTTPS certificate directives on the live server. `deploy.sh` only patches the Business OS frontend site with the upload-size directive when it is missing; other websites are not modified.
