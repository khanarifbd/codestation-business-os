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

The first staging environment uses SQLite:

```text
sqlite:////data/codestation_business_os.db
```

Inside Docker the SQLite database lives in a persistent named volume, so rebuilding or replacing the backend container does not delete business data.

The SQLAlchemy and Alembic configuration accepts `DATABASE_URL`, so production can move to PostgreSQL without changing the application architecture.

Example PostgreSQL URL:

```text
postgresql+psycopg://user:password@host:5432/codestation_business_os
```

## Local backend setup

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

This keeps the stack isolated from any existing public website on the VPS. Nginx exposes the applications through separate subdomains.

### 1. Server prerequisites

Install Git, Docker Engine, Docker Compose plugin, Nginx, and Certbot on the VPS.

### 2. Clone and select the staging branch

```bash
git clone https://github.com/arifxpartbd/codestation-business-os.git
cd codestation-business-os
git checkout agent/saas-foundation
```

For a private repository, use the server's configured SSH/deploy-key GitHub access instead of a password.

### 3. Create staging environment

```bash
cp .env.staging.example .env.staging
nano .env.staging
```

Set the real frontend and API domains:

```text
NEXT_PUBLIC_API_URL=https://api-os.example.com/api/v1
CORS_ORIGINS=https://os.example.com
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

The backend container automatically runs `alembic upgrade head` before starting the API.

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
