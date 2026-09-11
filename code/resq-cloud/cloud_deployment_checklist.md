# ResQ Cloud Deployment Checklist

This document details the configuration requirements, environment variables, database seed checklist, and build steps to prepare the ResQ Cloud backend and frontend services, as well as the LocalHub integration, for deployment.

> [!WARNING]
> Do NOT write real secrets, passwords, or active API keys into this or any other documentation. Always use secure placeholders.

---

## 1. Cloud API Backend Environment Variables

The backend is built with Spring Boot and runs on a PostgreSQL database. The production profile is activated using standard environment variables. Configure the following environment variables in your deployment environment (e.g., AWS Elastic Beanstalk, ECS, or local environment):

### Database Configuration
- **`CLOUD_DB_URL`**
  - **Description**: The JDBC connection URL for the PostgreSQL database.
  - **Placeholder**: `jdbc:postgresql://<database-host>:<port>/<database-name>`
  - **Default (Local)**: `jdbc:postgresql://localhost:5432/resq_cloud`
- **`CLOUD_DB_USERNAME`**
  - **Description**: The database user for migrations and API access.
  - **Placeholder**: `<database-username>`
  - **Default (Local)**: `resq_cloud`
- **`CLOUD_DB_PASSWORD`**
  - **Description**: The password for the database user.
  - **Placeholder**: `<database-password>`
  - **Default (Local)**: `resq_cloud_dev`

### Authentication & JWT Configuration
- **`RESQ_CLOUD_AUTH_JWT_SECRET`**
  - **Description**: The cryptographically secure secret key used to sign and verify JWT tokens. Must be a secure string (minimum 256-bit).
  - **Placeholder**: `<set-secure-secret-key>`
  - **Default (Local)**: `local-dev-change-me`
- **`RESQ_CLOUD_AUTH_JWT_ISSUER`**
  - **Description**: The issuer claim included in signed JWTs.
  - **Placeholder**: `resq-cloud-api`
- **`RESQ_CLOUD_AUTH_TOKEN_TTL_MINUTES`**
  - **Description**: The lifetime of the generated JWTs in minutes.
  - **Default**: `120`

### Server & Bootstrapping Configuration
- **`SPRING_PROFILES_ACTIVE`**
  - **Description**: Active Spring Boot profiles. Set to `prod` in production to enable connection pooling and disable verbose developer logs.
  - **Value**: `prod` (or `dev` for local testing)
- **`SERVER_PORT`** or **`CLOUD_API_PORT`**
  - **Description**: The port on which the web server listens. `SERVER_PORT` is the default standard for environments like AWS Elastic Beanstalk (set to `5000` automatically), while `CLOUD_API_PORT` is used as a local-dev override.
  - **Default (Local)**: `19080`
- **`RESQ_CLOUD_BOOTSTRAP_ADMIN_EMAIL`**
  - **Description**: The email address of the initial Admin user bootstrapped on startup.
  - **Placeholder**: `<admin-email-address>`
  - **Default (Local)**: `admin@resq.local`
- **`RESQ_CLOUD_BOOTSTRAP_ADMIN_PASSWORD`**
  - **Description**: The password for the bootstrapped Admin user.
  - **Placeholder**: `<admin-bootstrap-password>`
  - **Default (Local)**: `admin123`
- **`RESQ_CLOUD_BOOTSTRAP_ADMIN_NAME`**
  - **Description**: The display name of the bootstrapped Admin user.
  - **Default (Local)**: `ResQ Admin`

### CORS Settings
- **`RESQ_CLOUD_CORS_ALLOWED_ORIGINS`**
  - **Description**: Comma-separated list of additional CORS allowed origins (e.g., the URL of the deployed AWS Amplify frontend). Local dev origins (`http://localhost:*` and `http://127.0.0.1:*`) are always allowed automatically.
  - **Placeholder**: `https://<amplify-app-id>.amplifyapp.com`

### Hub Configuration
- Hub registration, syncing, and verification require inserting registered hubs into the database. A hub must have a valid `hub_id` and a hashed key (`key_hash`) stored in the database. See the seed data section below to configure local/deployed hub credentials.

---

## 2. Cloud Frontend Environment Variables

The web frontend is built using Vite and deployed via static hosting (e.g., AWS Amplify).

- **`VITE_CLOUD_API_BASE_URL`**
  - **Description**: The target API gateway URL for backend requests.
  - **Placeholder**: `https://<api-gateway-url>`
  - **Local testing**: `http://localhost:19080`

> [!IMPORTANT]
> - For a deployed AWS Amplify frontend, set `VITE_CLOUD_API_BASE_URL` in the **Amplify Console -> Environment Variables**.
> - After updating the environment variables in Amplify, you **must trigger a redeploy** of the frontend application for the updated values to take effect in the client bundle.

---

## 3. LocalHub Sync Environment Variables

Configure these environment variables on the LocalHub machine running the local desktop client to toggle and connect sync functionality.

### Local Cloud Test Mode (LocalHub -> Local Cloud API)
Use this setup when testing the system completely on your local workstation:

```powershell
$env:RESQ_CLOUD_SYNC_ENABLED="true"
$env:RESQ_ROSTER_SYNC_ENABLED="true"
$env:RESQ_CLOUD_SYNC_BASE_URL="http://localhost:19080"
$env:RESQ_ROSTER_SYNC_BASE_URL="http://localhost:19080"
$env:RESQ_ROSTER_SYNC_HUB_ID="<hub-id>"
$env:RESQ_ROSTER_SYNC_HUB_KEY="<hub-key>"
```

### Deployed Cloud Test Mode (LocalHub -> Deployed API Gateway)
Use this setup when testing the local desktop client sync with the cloud staging or production deployment:

```powershell
$env:RESQ_CLOUD_SYNC_ENABLED="true"
$env:RESQ_ROSTER_SYNC_ENABLED="true"
$env:RESQ_CLOUD_SYNC_BASE_URL="https://<api-gateway-url>"
$env:RESQ_ROSTER_SYNC_BASE_URL="https://<api-gateway-url>"
$env:RESQ_ROSTER_SYNC_HUB_ID="<hub-id>"
$env:RESQ_ROSTER_SYNC_HUB_KEY="<hub-key>"
```

---

## 4. Demo Seed Data Checklist

Ensure the database contains the following test records before beginning the E2E verification:

1. **ADMIN user**:
   - Role: `ADMIN`
   - Required fields: Email, Name, Password hash
2. **INSTRUCTOR user**:
   - Role: `INSTRUCTOR`
   - Required fields: Email, Name, Password hash
3. **TRAINEE user**:
   - Role: `TRAINEE`
   - Required fields: Email, Name, Password hash
4. **At least one course**:
   - Required fields: Course code, title, active status
5. **Instructor assigned to course**:
   - A record linking the course to the Instructor user.
6. **Trainee enrolled in course**:
   - A record linking the Trainee user to the course.
7. **LocalHub PIN/password set**:
   - Instructors and Trainees must have a valid PIN/local login password set in the cloud database (hashed using BCrypt) so they can log in offline at the LocalHub.
8. **Registered Hub ID & Key**:
   - Register a Hub record in `cloud_hub_api_keys` with a unique ID and a hashed API key (using BCrypt) matching the plaintext `<hub-key>` configured in the LocalHub env vars.

---

## 5. Build and Package Commands

Use the following commands to test, build, and package the frontend and backend modules:

### Cloud API Backend Build

```powershell
cd services/cloud-api
.\mvnw.cmd test
.\mvnw.cmd clean package
```

### Cloud Frontend Build

```powershell
cd "D:\Semester 6\3YP\e21-3yp-ResQ\code\resq-cloud"
pnpm --filter cloud-web build
```
