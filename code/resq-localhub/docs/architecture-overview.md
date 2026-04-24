# Architecture Overview

## Runtime on Instructor PC

The instructor PC runs the Local Hub desktop app and local services:

- Tauri desktop shell with React UI
- Local Spring Boot API (`hub-api`)
- Local Mosquitto broker
- Local SQLite database (planned next)

This enables operation even when internet is unavailable.

## Local-First Data Flow

1. User actions are handled in the desktop app.
2. The app calls the local API.
3. The local API persists data locally first.
4. Cloud sync is performed later when connectivity is available.

## What Stays Local

- Active session state
- Local service status and diagnostics
- Operational data required for offline usage

## What Syncs Later to Cloud

- Session summaries and relevant records
- Selected logs/telemetry intended for remote dashboards
- Data needed for cross-device visibility

Cloud sync is intentionally deferred to keep this phase simple and robust offline.

## Why SQLite

- Embedded and lightweight
- Zero external database server required
- Easy to ship in a Windows-first desktop workflow
- Good fit for local-first persistence

## Why Mosquitto

- Widely used lightweight MQTT broker
- Suitable for local pub/sub communication between local components
- Easy to run and configure for offline-first use cases

## Why Tauri

- Native desktop shell with low runtime overhead
- Good fit for shipping a Windows-first app with web UI technology
- Tight integration between Rust side and frontend command calls

## Why Spring Boot

- Familiar and productive backend framework
- Strong ecosystem and maintainability
- Easy to expose API endpoints for desktop-local orchestration
