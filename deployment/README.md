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

## One-command deploy

The staging server tracks the `develop` branch. From the repository root:

```bash
sudo bash deployment/deploy.sh
```

The script:

1. ensures JWT and platform super-admin bootstrap secrets exist
2. fetches and fast-forwards `develop`
3. builds backend and frontend images
4. starts/waits for PostgreSQL
5. runs `alembic upgrade head`
6. starts backend and frontend
7. API startup guarantees at least one active `super_admin`
8. checks backend and frontend health
9. prints container status

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

The live Nginx file is managed by the server under `/etc/nginx/sites-available/`. The repository copy is the source/template for disaster recovery and future server moves. Certbot manages the HTTPS certificate directives on the live server.
