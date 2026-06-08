# ResQ Cloud Auth/RBAC Local MVP

## Purpose

Phase 8 protects the local `cloud-api` and `cloud-dashboard` with BCrypt
passwords, signed JWT access tokens, and role-based authorization.

This is local-development authentication only. It does not use AWS, Cognito,
an external identity provider, refresh tokens, or production browser token
storage.

LocalHub live training does not depend on cloud authentication. The existing
machine sync POST remains public for the local MVP.

## Database Migration

Flyway migration
`services/cloud-api/src/main/resources/db/migration/V3__add_cloud_auth_fields.sql`
adds these nullable columns to `cloud_users`:

- `password_hash`
- `last_login_at`
- `password_updated_at`

Existing users may have a null password hash and cannot log in until an admin
sets a password. Password hashes are BCrypt values and are never included in
API response DTOs.

New users require a password of at least eight characters. The dashboard lets
an admin set a password during creation or replace it while editing a user.

## Bootstrap Admin

At startup, `cloud-api` creates a bootstrap administrator only when no `ADMIN`
user exists:

| Field | Local default |
|---|---|
| Display name | `ResQ Admin` |
| Email | `admin@resq.local` |
| Password | `admin123` |
| Role | `ADMIN` |

The password is BCrypt-hashed before storage and is never written to logs.

These credentials are for local development only. Change the password and JWT
secret before using the service outside an isolated development machine.

If a database already contains an `ADMIN`, no additional bootstrap admin is
created. An older admin with a null password hash must have its password reset
through an authenticated admin account or directly during local recovery.

## Configuration

| Environment variable | Default |
|---|---|
| `RESQ_CLOUD_AUTH_JWT_SECRET` | `local-dev-change-me` |
| `RESQ_CLOUD_AUTH_JWT_ISSUER` | `resq-cloud-api` |
| `RESQ_CLOUD_AUTH_TOKEN_TTL_MINUTES` | `120` |
| `RESQ_CLOUD_BOOTSTRAP_ADMIN_EMAIL` | `admin@resq.local` |
| `RESQ_CLOUD_BOOTSTRAP_ADMIN_PASSWORD` | `admin123` |
| `RESQ_CLOUD_BOOTSTRAP_ADMIN_NAME` | `ResQ Admin` |

The configured secret is converted to a SHA-256 signing key and used for
HS256 JWT signatures. Tokens include `sub`, `email`, `role`, issuer, issued
time, and expiration.

Example PowerShell overrides:

```powershell
$env:RESQ_CLOUD_AUTH_JWT_SECRET = "replace-with-a-long-random-local-secret"
$env:RESQ_CLOUD_AUTH_TOKEN_TTL_MINUTES = "60"
$env:RESQ_CLOUD_BOOTSTRAP_ADMIN_PASSWORD = "replace-local-password"
```

## Auth Endpoints

- `POST /api/cloud/auth/login` is public.
- `GET /api/cloud/auth/me` requires a bearer token.
- `POST /api/cloud/auth/logout` requires a bearer token.

Logout is client-side for this JWT MVP. It does not blacklist an already
issued token.

## Endpoint Access Matrix

| Endpoint group | ADMIN | INSTRUCTOR | TRAINEE | Public |
|---|---:|---:|---:|---:|
| `GET /api/cloud/health` | Yes | Yes | Yes | Yes |
| `POST /api/cloud/auth/login` | Yes | Yes | Yes | Yes |
| `/api/cloud/auth/me`, `/logout` | Yes | Yes | Yes | No |
| Session review GET endpoints | Yes | Yes | No | No |
| User GET endpoints | Yes | Yes | No | No |
| Course/enrollment GET endpoints | Yes | Yes | No | No |
| User/course/enrollment writes | Yes | No | No | No |
| `POST /api/sync/session-summaries` | Yes | Yes | Yes | Yes |
| Sync diagnostic GET lookup | Yes | Yes | No | No |

The public sync POST is the deliberate Phase 8 compatibility exception.
Machine-to-machine sync authentication is deferred to Phase 9.

## Dashboard Flow

The dashboard adds:

- `/login` for email/password login.
- `/me` for the signed-in account and trainee placeholder.
- Protected session, analytics, user, course, and course-detail routes.
- Bearer tokens on protected API requests.
- Automatic local sign-out and redirect on HTTP `401`.

For this local MVP, the access token and user summary are stored in
`localStorage`. Production should use safer token handling.

Navigation follows the role:

- `ADMIN`: sessions, analytics, courses, users, and account.
- `INSTRUCTOR`: sessions, analytics, read-only courses, and account.
- `TRAINEE`: `My History coming later` placeholder only.

## Run Locally

Start PostgreSQL, then:

```powershell
cd services/cloud-api
.\mvnw.cmd spring-boot:run
```

In another terminal:

```powershell
cd apps/cloud-dashboard
pnpm install
pnpm dev
```

Open `http://localhost:1430/login`.

## Manual API Test

Login:

```powershell
$login = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:19080/api/cloud/auth/login `
  -ContentType "application/json" `
  -Body '{"email":"admin@resq.local","password":"admin123"}'

$headers = @{ Authorization = "Bearer $($login.accessToken)" }
```

Read the current account:

```powershell
Invoke-RestMethod http://localhost:19080/api/cloud/auth/me -Headers $headers
```

Create an instructor and trainee:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:19080/api/cloud/users `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"displayName":"Local Instructor","email":"instructor@resq.local","role":"INSTRUCTOR","password":"password123"}'

Invoke-RestMethod -Method Post `
  -Uri http://localhost:19080/api/cloud/users `
  -Headers $headers `
  -ContentType "application/json" `
  -Body '{"displayName":"Local Trainee","email":"trainee@resq.local","role":"TRAINEE","password":"password123"}'
```

Prove an unauthenticated management request fails:

```powershell
Invoke-WebRequest http://localhost:19080/api/cloud/users -SkipHttpErrorCheck
```

Login as the trainee and prove session review returns HTTP `403`:

```powershell
$traineeLogin = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:19080/api/cloud/auth/login `
  -ContentType "application/json" `
  -Body '{"email":"trainee@resq.local","password":"password123"}'

Invoke-WebRequest `
  http://localhost:19080/api/cloud/sessions `
  -Headers @{ Authorization = "Bearer $($traineeLogin.accessToken)" } `
  -SkipHttpErrorCheck
```

## Tests

```powershell
cd services/cloud-api
.\mvnw.cmd test

cd ..\..\apps\cloud-dashboard
pnpm test
pnpm build
```

## Out Of Scope

- AWS deployment, SDKs, credentials, or secrets
- Cognito or another external identity provider
- Refresh tokens and token revocation lists
- Production browser token storage
- Production RBAC administration and audit logging
- Machine-to-machine sync authentication
- LocalHub roster synchronization
- Live training controls
- Firmware, MQTT, SSE, pairing, or calibration changes
