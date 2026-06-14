package lk.resq.localhub.service;

import org.springframework.stereotype.Component;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Component
public class RateEstimatorRegistry {

    private final ConcurrentMap<EstimatorKey, RateEstimator> estimators = new ConcurrentHashMap<>();

    public double getOrEstimateRate(String deviceId, String sessionId, Double depthProgress, Double depthMm, Long tsMs, Double incomingRate) {
        if (deviceId == null || sessionId == null) {
            if (incomingRate != null && incomingRate > 0.0 && !incomingRate.isNaN() && incomingRate <= 240.0) {
                return incomingRate;
            }
            return 0.0;
        }

        EstimatorKey key = new EstimatorKey(deviceId, sessionId);
        RateEstimator estimator = estimators.computeIfAbsent(key, k -> new RateEstimator());
        return estimator.update(depthProgress, depthMm, tsMs, incomingRate);
    }

    public void clearForSession(String deviceId, String sessionId) {
        if (deviceId != null && sessionId != null) {
            estimators.remove(new EstimatorKey(deviceId, sessionId));
        }
    }

    public void clearForDevice(String deviceId) {
        if (deviceId != null) {
            estimators.keySet().removeIf(key -> deviceId.equals(key.deviceId()));
        }
    }

    public record EstimatorKey(String deviceId, String sessionId) {
    }

    static class RateEstimator {
        private boolean compressed = false;
        private Long lastStartTimeMs = null;
        private double lastRate = 0.0;

        public synchronized double update(Double depthProgress, Double depthMm, Long tsMs, Double incomingRate) {
            long now = tsMs != null ? tsMs : System.currentTimeMillis();

            boolean thresholdExceeded = false;
            boolean thresholdReset = false;

            if (depthProgress != null) {
                if (depthProgress >= 0.2) {
                    thresholdExceeded = true;
                } else if (depthProgress <= 0.1) {
                    thresholdReset = true;
                }
            } else if (depthMm != null) {
                if (depthMm >= 10.0) {
                    thresholdExceeded = true;
                } else if (depthMm <= 5.0) {
                    thresholdReset = true;
                }
            }

            if (thresholdReset) {
                compressed = false;
            } else if (thresholdExceeded && !compressed) {
                compressed = true;
                if (lastStartTimeMs != null) {
                    long interval = now - lastStartTimeMs;
                    if (interval >= 250 && interval <= 2000) {
                        lastRate = 60000.0 / interval;
                    }
                }
                lastStartTimeMs = now;
            }

            if (lastStartTimeMs != null && (now - lastStartTimeMs) > 2000) {
                lastRate = 0.0;
            }

            if (incomingRate != null && incomingRate > 0.0 && !incomingRate.isNaN() && incomingRate <= 240.0) {
                return incomingRate;
            }

            return lastRate;
        }
    }
}
