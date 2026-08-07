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

1. fetches and fast-forwards `develop`
2. builds backend and frontend images
3. starts/waits for PostgreSQL
4. runs `alembic upgrade head`
5. starts backend and frontend
6. checks backend and frontend health
7. prints container status

## Secrets

`.env.staging` lives at the repository root and is not committed. It must contain the PostgreSQL password and JWT secret.

Generate secure values with:

```bash
openssl rand -hex 32
```

## Nginx / SSL

The live Nginx file is managed by the server under `/etc/nginx/sites-available/`. The repository copy is the source/template for disaster recovery and future server moves. Certbot manages the HTTPS certificate directives on the live server.
