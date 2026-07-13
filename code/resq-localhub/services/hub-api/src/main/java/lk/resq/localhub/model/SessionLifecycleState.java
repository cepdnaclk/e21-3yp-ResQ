package lk.resq.localhub.model;

public enum SessionLifecycleState {
    START_PENDING,
    ACTIVE,
    START_REJECTED,
    START_TIMEOUT,
    STOP_PENDING,
    COMPLETED,
    STOP_REJECTED,
    STOP_TIMEOUT,
    INTERRUPTED
}
