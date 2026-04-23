# Development Plan

## Phase 1: Scaffold

- Create repository structure
- Add desktop, backend, and infra skeletons
- Add initial docs and guardrails

## Phase 2: Health + Desktop Status

- Connect desktop UI to backend health endpoint
- Show API and broker status in Home page cards
- Improve diagnostics placeholders

## Phase 3: Broker/Backend Process Management

- Add local service startup/check workflows
- Add basic local process control and status reporting
- Harden offline startup behavior

## Phase 4: Pairing and Sessions

- Introduce pairing workflow
- Add local session lifecycle management
- Persist session data to local store

## Phase 5: Cloud Sync

- Implement sync queue from local store
- Add retry/backoff and conflict strategy
- Keep local-first behavior as default even when cloud is enabled
