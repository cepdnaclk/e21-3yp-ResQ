import { getHubApiBaseUrl } from "./hubApiUrl";
import { getStoredToken } from "./tokenStore";

export interface TraineeRecord {
  id: string;
  traineeCode: string;
  displayName: string;
  groupName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/**
 * Fetch list of active trainee records.
 */
export async function fetchTrainees(): Promise<TraineeRecord[]> {
  const token = getStoredToken();
  const response = await fetch(`${getHubApiBaseUrl()}/api/trainees`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch trainees: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get a specific trainee record by ID.
 */
export async function fetchTraineeById(id: string): Promise<TraineeRecord> {
  const token = getStoredToken();
  const response = await fetch(`${getHubApiBaseUrl()}/api/trainees/${id}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Trainee not found: ${id}`);
    }
    throw new Error(`Failed to fetch trainee: ${response.statusText}`);
  }

  return response.json();
}

export interface CreateTraineeRequest {
  traineeCode: string;
  displayName: string;
  groupName?: string;
  notes?: string;
}

/**
 * Create a new trainee record.
 */
export async function createTrainee(request: CreateTraineeRequest): Promise<TraineeRecord> {
  const token = getStoredToken();
  const response = await fetch(`${getHubApiBaseUrl()}/api/trainees`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to create trainee: ${response.statusText}`);
  }

  return response.json();
}

export interface UpdateTraineeRequest {
  displayName?: string;
  groupName?: string;
  notes?: string;
}

/**
 * Update an existing trainee record.
 */
export async function updateTrainee(id: string, request: UpdateTraineeRequest): Promise<TraineeRecord> {
  const token = getStoredToken();
  const response = await fetch(`${getHubApiBaseUrl()}/api/trainees/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to update trainee: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Archive a trainee record (soft delete).
 */
export async function archiveTrainee(id: string): Promise<void> {
  const token = getStoredToken();
  const response = await fetch(`${getHubApiBaseUrl()}/api/trainees/${id}/archive`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to archive trainee: ${response.statusText}`);
  }
}
