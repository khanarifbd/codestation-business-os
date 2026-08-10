# Deployment

This folder is the canonical server/deployment layer for CodeStation Business OS.

## Contents

- `deploy.sh` — one-command staging deployment
- `docker-compose.yml` — PostgreSQL, FastAPI, and Next.js services
- `nginx/codestation-business-os.conf` — source Nginx reverse-proxy configuration

## Staging server

- Frontend: `https://os.codestationai.com`
- API: `https://api-os.codestationai.com`
- Frontend local bind: `127.0.0.1:3100`
- Backend local bind: `127.0.0.1:8100`
- PostgreSQL is only exposed inside the Docker network.

## Persistent data

Docker named volumes persist database and document data across normal image rebuilds/container recreation:

- `business_os_postgres` — PostgreSQL data
- `business_os_uploads` — private company document uploads (`/data/uploads` in the backend container)

Company files are not exposed as a public static directory. Authenticated tenant routes stream them after membership/role validation. The storage service is adapter-based so local VPS storage can later be replaced by S3/R2 without changing the company document database contract.

## One-command deploy

The staging server tracks the `develop` branch. From the repository root:

```bash
sudo bash deployment/deploy.sh
```

The script:

1. ensures JWT and platform super-admin bootstrap secrets exist
2. fetches and fast-forwards `develop`
3. safely ensures the Business OS frontend Nginx site accepts up to 25 MB requests
4. builds backend and frontend images
5. starts/waits for PostgreSQL
6. runs `alembic upgrade head`
7. starts backend and frontend
8. API startup guarantees at least one active `super_admin`
9. checks backend and frontend health
10. prints container status

## Secrets

`.env.staging` lives at the repository root and is not committed. It contains PostgreSQL, JWT, and super-admin bootstrap secrets.

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