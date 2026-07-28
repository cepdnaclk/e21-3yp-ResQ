package lk.resq.localhub.model.ingestion;

public record IngestionValidationResult(
        boolean accepted,
        String reasonCode,
        String detail
) {
    public static IngestionValidationResult valid() {
        return new IngestionValidationResult(true, "ACCEPTED", null);
    }

    public static IngestionValidationResult rejected(String reasonCode, String detail) {
        return new IngestionValidationResult(false, reasonCode, detail);
    }
}
