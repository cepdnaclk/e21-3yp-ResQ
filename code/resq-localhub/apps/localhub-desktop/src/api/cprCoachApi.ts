import { fetchLocalHubApi } from "../lib/apiClient";

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
  const response = await fetchLocalHubApi("/api/coach/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || "Failed to query ResQ Coach.");
  }

  return response.json();
}

export async function queryInstructorCoach(request: CprInstructorCoachQueryRequest): Promise<CprInstructorCoachQueryResponse> {
  const response = await fetchLocalHubApi("/api/instructor/coach/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || "Failed to query instructor coach.");
  }

  return response.json();
}
