package lk.resq.localhub.model.firmware;

import java.util.List;

public record CalibrationEvidenceDetail(
        CalibrationEvidence evidence,
        List<CalibrationEventLog> logs
) {
}
