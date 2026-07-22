package lk.resq.localhub.model.firmware;

import lk.resq.localhub.model.ManikinLiveSummary;

import java.util.List;

public record FirmwareDeviceDiagnosticsResponse(
        String deviceId,
        DeviceReadinessState readiness,
        FirmwareCalibrationResultRecord latestCalibration,
        ManikinLiveSummary liveSummary,
        List<FirmwareCommandRequestRecord> recentCommands,
        List<FirmwareEventRecord> recentEvents,
        List<FirmwareDebugSnapshotRecord> recentDebugSnapshots
) {
}
