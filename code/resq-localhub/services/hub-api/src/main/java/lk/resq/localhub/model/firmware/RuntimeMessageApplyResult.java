package lk.resq.localhub.model.firmware;

public record RuntimeMessageApplyResult(
        RuntimeMessageDisposition disposition,
        DeviceRuntimeState state,
        boolean bootChanged,
        String previousBootId,
        String currentBootId
) {
    public boolean domainMutationAllowed() {
        return disposition == RuntimeMessageDisposition.ACCEPTED
                || disposition == RuntimeMessageDisposition.LEGACY_ACCEPTED;
    }
}
