package lk.resq.localhub.model.firmware;

public enum RuntimeMessageDisposition {
    ACCEPTED,
    DUPLICATE,
    STALE_SEQUENCE,
    SUPERSEDED_BOOT,
    LEGACY_ACCEPTED,
    LEGACY_IGNORED,
    INVALID_ORDERING_FIELDS
}
