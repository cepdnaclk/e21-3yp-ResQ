# ResQ Cloud Management MVP

## Purpose

Phase 7 adds local cloud-side management for users, courses, and course
enrollments. It extends the existing PostgreSQL-backed `cloud-api` and the
separate React cloud dashboard.

Phase 8 adds local authentication and role-based authorization around these
management pages. Production identity integration is still not enabled. See
`docs/cloud-auth-rbac-local.md`.

Existing session sync remains independent of these records. Synced session
payloads may continue to contain null trainee or instructor identifiers.

## Entities

- A cloud user has a display name, optional unique email, role, and active flag.
- A cloud course has an optional unique code, title, description, optional
  instructor, and active flag.
- A cloud enrollment links one trainee to one course and can be active or
  inactive.

Allowed user roles are `ADMIN`, `INSTRUCTOR`, and `TRAINEE`. A course
instructor must be an active or inactive user with the `INSTRUCTOR` or `ADMIN`
role. Only a `TRAINEE` can be enrolled.

## Database Tables

Flyway migration
`services/cloud-api/src/main/resources/db/migration/V2__create_cloud_management_tables.sql`
creates:

- `cloud_users`
- `cloud_courses`
- `cloud_enrollments`

The enrollment table has a unique `(course_id, trainee_id)` constraint.
Removing an enrollment sets `active=false`; enrolling the same trainee again
reactivates that row instead of creating a duplicate.

Flyway applies V2 automatically when `cloud-api` starts.

## API Endpoints

Users:

- `POST /api/cloud/users`
- `GET /api/cloud/users`
- `GET /api/cloud/users/{userId}`
- `PATCH /api/cloud/users/{userId}`

Courses:

- `POST /api/cloud/courses`
- `GET /api/cloud/courses`
- `GET /api/cloud/courses/{courseId}`
- `PATCH /api/cloud/courses/{courseId}`

Enrollments:

- `POST /api/cloud/courses/{courseId}/enrollments`
- `GET /api/cloud/courses/{courseId}/enrollments`
- `DELETE /api/cloud/courses/{courseId}/enrollments/{traineeId}`

Validation failures return HTTP `400`, missing records return `404`, and
duplicate email or course code conflicts return `409`.

## Dashboard Pages

The management pages are part of `apps/cloud-dashboard`:

- `/management/users` lists, creates, edits, activates, and deactivates users.
- `/management/courses` lists and creates courses and assigns instructors.
- `/management/courses/:courseId` shows course details and manages trainee
  enrollment.

The dashboard displays a persistent local-auth warning. The existing
`/sessions` and `/analytics` routes remain available to administrators and
instructors.

## Run PostgreSQL

Verify the local PostgreSQL service:

```powershell
pg_isready -h localhost -p 5432
```

Initial database creation and environment variables are documented in
`docs/cloud-api-postgres.md`.

## Run Cloud API

```powershell
cd services/cloud-api
.\mvnw.cmd spring-boot:run
```

The default API URL is `http://localhost:19080`.

## Run Cloud Dashboard

```powershell
cd apps/cloud-dashboard
pnpm install
pnpm dev
```

Open `http://localhost:1430/management/users`.

The dashboard API base URL defaults to:

```text
VITE_CLOUD_API_BASE_URL=http://localhost:19080
```

Override it before starting Vite when needed:

```powershell
$env:VITE_CLOUD_API_BASE_URL = "http://localhost:19080"
pnpm dev
```

## Manual Test Flow

1. Start PostgreSQL, `cloud-api`, and `cloud-dashboard`.
2. Open `/management/users` and create an instructor.
3. Create a trainee on the same page.
4. Open `/management/courses`, create a course, and assign the instructor.
5. Open the course detail page and enroll the trainee.
6. Verify the instructor and trainee appear on the list and detail pages.
7. Remove the enrollment and verify it becomes inactive.
8. Select the inactive trainee and add them again to verify reactivation.
9. Open `/sessions` to confirm existing synced session review still works.

## Checks

```powershell
cd services/cloud-api
.\mvnw.cmd package

cd ..\..\apps\cloud-dashboard
pnpm test
pnpm build
```

## Out Of Scope

- AWS deployment, SDKs, credentials, or secrets
- Cognito, external identity providers, or production RBAC enforcement
- Cloud user sign-in or password management
- LocalHub roster synchronization
- Live telemetry or training controls
- Firmware commands
- MQTT, SSE, pairing, calibration, or LocalHub behavior changes
