package lk.resq.cloudapi.model;

public record CloudSessionSyncResponse(
        boolean accepted,
        String result,
        String cloudSessionId,
        String idempotencyKey,
        String contractVersion,
        String message
) {
}
