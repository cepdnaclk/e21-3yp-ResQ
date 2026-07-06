package lk.resq.localhub.model.cpr;

public record CprSessionSummaryQueryRequest(
        String userId,
        String traineeId,
        String from,
        String to,
        String manikinId
) {
}