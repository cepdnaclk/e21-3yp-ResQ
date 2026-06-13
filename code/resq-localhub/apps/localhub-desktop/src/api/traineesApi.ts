/**
 * traineesApi.ts — V2 trainee CRUD API.
 */

import { getJson, postJson, patchJson } from "./localHubClient";
import type { TraineeRecord, CreateTraineeRequest, UpdateTraineeRequest } from "../types/trainee";

/** GET /api/trainees */
export async function fetchTrainees(): Promise<TraineeRecord[]> {
  return getJson<TraineeRecord[]>("/api/trainees");
}

/** GET /api/trainees/{id} */
export async function fetchTrainee(id: string): Promise<TraineeRecord> {
  return getJson<TraineeRecord>(`/api/trainees/${encodeURIComponent(id)}`);
}

/** POST /api/trainees */
export async function createTrainee(request: CreateTraineeRequest): Promise<TraineeRecord> {
  return postJson<TraineeRecord>("/api/trainees", request);
}

/** PATCH /api/trainees/{id} */
export async function updateTrainee(id: string, request: UpdateTraineeRequest): Promise<TraineeRecord> {
  return patchJson<TraineeRecord>(`/api/trainees/${encodeURIComponent(id)}`, request);
}

/** POST /api/trainees/{id}/archive */
export async function archiveTrainee(id: string): Promise<void> {
  return postJson<void>(`/api/trainees/${encodeURIComponent(id)}/archive`);
}
