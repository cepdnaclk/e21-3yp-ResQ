# ResQ Stack Migration

This repository now includes a React/Vite frontend and a Spring Boot backend with dual database support.

## Structure

- `frontend/` - React + Vite UI
- `backend/` - Spring Boot API
- `backend/src/main/resources/schema-local.sql` - SQLite schema for local development
- `backend/src/main/resources/schema-cloud.sql` - PostgreSQL schema for cloud deployment

## Run Locally

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd backend
mvn spring-boot:run
```

The Vite dev server proxies `/api` requests to `http://localhost:8080`.

## Database Profiles

### Local

- Uses SQLite
- Default Spring profile: `local`
- Database file: `backend/data/resq-local.db`

### Cloud

- Uses PostgreSQL
- Set `SPRING_PROFILES_ACTIVE=cloud`
- Provide `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, and `SPRING_DATASOURCE_PASSWORD`

## API Endpoints

The backend exposes the same hub routes the UI expects:

- `POST /api/auth/login`
- `GET /api/hub/health`
- `GET /api/mock/live`
- `GET /api/mock/session/active`
- `POST /api/mock/session/start`
- `POST /api/mock/session/end`
- `GET /api/mock/session/last-summary`
