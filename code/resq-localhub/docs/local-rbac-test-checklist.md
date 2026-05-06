# Local RBAC Test Checklist

Purpose
-------

This document explains how the ResQ LocalHub implements and should be tested for local role-based access control (RBAC). It is intended for developers and testers working with the local, offline-first desktop + backend stack.

Roles & Permissions
-------------------

- ADMIN
  - Full access to administrative actions such as user management, diagnostics, and any admin-only routes.
- INSTRUCTOR
  - Access to instructor operations: view live manikins, start/end sessions, export session data, subscribe to instructor SSE streams.
- TRAINEE
  - Limited access: trainee dashboard, view own session data (where ownership is enforced by backend), no instructor/admin actions.

Why SQLite-backed opaque session tokens (MVP)
--------------------------------------------

- Simplicity: local, single-node runtime suitable for offline-first desktop use.
- Security: tokens are opaque random values stored hashed in SQLite (no JWT claims baked into client-visible tokens).
- No external dependency: avoids JWKS/JWT signing infrastructure for a local-only product.
- Future path: the design keeps options open to migrate to JWT/JWKS and cloud identity later.

Manual backend API tests
------------------------

Use curl, httpie, or Postman against the local hub API (default host/port depends on your dev setup). Examples assume `http://localhost:18080`.

1. Check status

   GET /api/auth/status

   - Expect JSON: `{ hasUsers: boolean, requiresFirstAdmin: boolean }`.
   - If `requiresFirstAdmin: true`, follow the first-admin flow below.

2. First admin setup (when required)

   POST /api/auth/setup
   - Body: `{ username, displayName, password }`.
   - On success: returns login response (user + expiry) and sets session cookie.
   - After success, GET /api/auth/me should return the created user.

3. Login

   POST /api/auth/login
   - Body: `{ username, password }`.
   - On success: server sets an HttpOnly session cookie and returns user/expiresAt.

4. Authenticated endpoints

   - GET /api/auth/me — should return current user when authenticated, 401 when not.
   - Instructor-only endpoints (examples):
     - GET /api/stream/manikins/live — expect 403 for TRAINEE, 401 for anonymous.
     - POST /api/sessions/start and POST /api/sessions/end — expect 403 for TRAINEE, 401 for anonymous.
     - GET /api/sessions and GET /api/sessions/{id} — instructor access; TRAINEE can view own session when ownership is set.

5. Logout

   POST /api/auth/logout
   - Should revoke server-side session and return success; subsequent protected calls return 401.

Manual frontend tests (desktop / web)
-----------------------------------

1. First-run setup
   - Start backend and open the desktop/web app. If `requiresFirstAdmin` is true, the Login page should show a First Run Setup tab.
   - Create first ADMIN account; on success you should be redirected to instructor dashboard.

2. Login flows
   - Login as ADMIN, INSTRUCTOR, and TRAINEE and verify redirection:
     - ADMIN / INSTRUCTOR -> instructor dashboard
     - TRAINEE -> trainee dashboard

3. UI role gating (UX-only)
   - While logged in as TRAINEE, instructor-only UI elements (Start/End session buttons, export links, Users/Diagnostics nav) should be hidden.
   - Attempting to open instructor-only routes should show Access Denied in the UI.

4. End-to-end protected actions
   - As INSTRUCTOR, start a session, observe SSE/live updates in instructor UI, and end the session.
   - Download/export session JSON/CSV as INSTRUCTOR/ADMIN.
   - As TRAINEE, attempt to call instructor endpoints from the browser (developer console / API client) and confirm backend responds 403.

Expected 401 and 403 behavior
-----------------------------

- 401 Unauthorized: returned by the backend when no valid session token/cookie is provided. Frontend should route unauthenticated users to login.
- 403 Forbidden: returned by the backend when authentication exists but the authenticated user lacks the required role for that endpoint. Frontend should show Access Denied when a user navigates to a route they lack permission for.

Known Future Work
-----------------

- User management UI: richer admin screens for creating/disable/role-change users.
- Trainee ownership enforcement: backend routes should consistently enforce that TRAINEE users may only access their own session data; frontend should reflect these constraints too.
- Cloud JWT/JWKS auth: optional future migration for a cloud-enabled offering (token introspection, signature verification, centralized identity).
- MQTT ACL hardening: tighten MQTT broker ACLs to enforce topic-level permissions per-role and per-device.
- Tauri secure token storage: replace localStorage tokenStore with Tauri secure storage for production desktop builds.

Notes
-----

- The frontend hides controls for UX clarity, but all access control is enforced by the backend. Never assume the frontend alone enforces security.
- The current session design stores opaque tokens hashed in SQLite; tokens are not JWTs and do not contain client-visible claims.

Document created for quick manual QA and developer onboarding for local RBAC testing.
