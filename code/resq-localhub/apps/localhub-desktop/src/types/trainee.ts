/**
 * trainee.ts — Trainee record types for V2.
 */

export type TraineeRecord = {
  id: string;
  traineeCode: string;
  displayName: string;
  groupName: string | null;
  notes: string | null;
  createdAt: string;
  archivedAt: string | null;
};

export type CreateTraineeRequest = {
  traineeCode: string;
  displayName: string;
  groupName?: string | null;
  notes?: string | null;
};

export type UpdateTraineeRequest = {
  displayName?: string | null;
  groupName?: string | null;
  notes?: string | null;
};
