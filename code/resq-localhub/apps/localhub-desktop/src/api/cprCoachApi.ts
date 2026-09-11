import { postJson } from "./localHubClient";

export interface CprCoachQueryRequest {
  userId: string;
  question: string;
  fromDate?: string;
  toDate?: string;
}

export interface CprCoachQueryResponse {
  answer: string;
  mainIssues: string[];
  recommendations: string[];
  badSessions: {
    sessionId: string;
    sessionDateTime: string;
    overallScore: number;
    failedMetrics: string[];
    shortReason: string;
    recommendation: string;
  }[];
  trendDirection: string;
}

export interface CprInstructorCoachQueryRequest {
  question: string;
}

export interface CprInstructorCoachQueryResponse {
  answer: string;
  priorityTrainees: {
    traineeId: string;
    name: string;
    lastSessionScore: number;
    reasonForAttention: string;
    lastSessionId: string;
  }[];
  commonIssues: string[];
  suggestedInstructorActions: string[];
  relatedSessionIds: string[];
}

export async function queryCoach(payload: CprCoachQueryRequest): Promise<CprCoachQueryResponse> {
  return postJson<CprCoachQueryResponse>("/api/coach/query", payload);
}

export async function queryInstructorCoach(request: CprInstructorCoachQueryRequest): Promise<CprInstructorCoachQueryResponse> {
  return postJson<CprInstructorCoachQueryResponse>("/api/instructor/coach/query", request);
}
