# CodeStation Business OS

SaaS-first business operating system for managing clients, orders, projects, finance, employees, reporting, and company operations from one workspace.

## Repository structure

```text
codestation-business-os/
├── backend/       # FastAPI + SQLAlchemy + Alembic
├── frontend/      # Next.js + TypeScript + Tailwind
├── docs/
└── infrastructure/
```

The frontend and backend live in one repository for local development, but they are independent applications and can be deployed to separate servers later.

## Local database

Local development uses SQLite by default:

```text
sqlite:///./codestation_business_os.db
```

The SQLAlchemy and Alembic configuration accepts `DATABASE_URL`, so production can move to PostgreSQL without changing the application architecture.

Example production-style URL:

```text
postgresql+psycopg://user:password@host:5432/codestation_business_os
```

## Backend setup

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

## Frontend setup

In another terminal:

```bash
cd frontend
cp .env.example .env.local
pnpm install
pnpm dev
```

Frontend URL:

- `http://localhost:3000`

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
