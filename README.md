# CodeStation Business OS

SaaS-first business operating system for managing clients, orders, projects, finance, employees, reporting, and company operations from one workspace.

## Repository structure

```text
codestation-business-os/
├── backend/       # FastAPI + SQLAlchemy + Alembic
├── frontend/      # Next.js + TypeScript + Tailwind
├── docs/
├── infrastructure/
└── docker-compose.staging.yml
```

The frontend and backend live in one repository, but they are independent applications and can be deployed to separate servers later.

## Database strategy

CodeStation Business OS is PostgreSQL-first from the beginning. Staging uses a dedicated PostgreSQL container with a persistent Docker volume. The database port is not published to the public host; the FastAPI backend connects to PostgreSQL over the private Docker network.

Application database URLs use the Psycopg 3 SQLAlchemy driver:

```text
postgresql+psycopg://user:password@host:5432/codestation_business_os
```

Alembic owns schema migrations. Moving the product to another VPS or a managed PostgreSQL service later only requires migrating the database data and changing `DATABASE_URL`/deployment environment configuration.

## Local backend setup

Run PostgreSQL locally or point `DATABASE_URL` at a development PostgreSQL database, then:

```bash
cd backend
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run fastapi dev app/main.py
```

Backend URLs:

- API: `http://127.0.0.1:8000`
- Swagger: `http://127.0.0.1:8000/docs`
- Database health: `http://127.0.0.1:8000/api/v1/health`

## Local frontend setup

```bash
cd frontend
cp .env.example .env.local
pnpm install
pnpm dev
```

Frontend URL:

- `http://localhost:3000`

## Staging VPS deployment

The staging stack uses Docker Compose and deliberately binds application ports to localhost only:

- frontend: `127.0.0.1:3100`
- backend: `127.0.0.1:8100`
- PostgreSQL: internal Docker network only; no public host port

This keeps the stack isolated from any existing public website on the VPS. Nginx exposes only the frontend and API through separate subdomains.

### 1. Server prerequisites

Install Git, Docker Engine, Docker Compose plugin, Nginx, and Certbot on the VPS.

### 2. Clone and select the staging branch

```bash
git clone git@github.com:arifxpartbd/codestation-business-os.git
cd codestation-business-os
git checkout agent/saas-foundation
```

### 3. Create staging environment

```bash
cp .env.staging.example .env.staging
nano .env.staging
```

Set the public domains and a long random PostgreSQL password:

```text
NEXT_PUBLIC_API_URL=https://api-os.example.com/api/v1
CORS_ORIGINS=https://os.example.com
POSTGRES_USER=business_os
POSTGRES_DB=codestation_business_os
POSTGRES_PASSWORD=<long-random-secret>
```

Do not commit `.env.staging`.

### 4. Build and start

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --build
```

Check status and logs:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml ps
docker compose --env-file .env.staging -f docker-compose.staging.yml logs -f --tail=100
```

PostgreSQL must become healthy before the backend starts. The backend then automatically runs `alembic upgrade head` before starting the API. The frontend starts after the backend becomes healthy.

### 5. Configure Nginx

Copy `infrastructure/nginx/codestation-business-os.conf.example` to an Nginx site file and replace:

- `os.example.com` with the real frontend subdomain
- `api-os.example.com` with the real API subdomain

Then enable and validate the Nginx configuration before reload.

### 6. Enable HTTPS

After both DNS records point to the VPS and Nginx is serving the domains, use Certbot to issue HTTPS certificates for the frontend and API subdomains.

### 7. Future deployments

The helper script can rebuild the current checked-out branch:

```bash
chmod +x infrastructure/deploy-staging.sh
./infrastructure/deploy-staging.sh
```

## SaaS foundation

The first data layer contains:

- `users` — global user identities
- `organizations` — tenant/company workspaces
- `memberships` — connects users to organizations with a role and status

Business modules will be scoped by organization so one SaaS installation can safely host multiple companies.

## Next development milestone

Authentication and company onboarding:

1. Sign up / sign in
2. Create company workspace
3. Create owner membership
4. JWT access + refresh token flow
5. Current organization context
6. Role and permission foundation
