package lk.resq.localhub.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

class RateEstimatorRegistryTest {

    private static final String DEVICE_ID = "M-001";
    private static final String SESSION_ID = "S-001";

    @Test
    void getOrEstimateRate_whenIncomingRateIsValid_returnsIncomingRate() {
        RateEstimatorRegistry registry = new RateEstimatorRegistry();

        double actual = registry.getOrEstimateRate(null, null, null, null, 1000L, 110.0);

        assertThat(actual).isCloseTo(110.0, within(0.0001));
    }

    @Test
    void getOrEstimateRate_whenIncomingRateIsAtMaximumBoundary_returns240() {
        RateEstimatorRegistry registry = new RateEstimatorRegistry();

        double actual = registry.getOrEstimateRate(null, null, null, null, 1000L, 240.0);

        assertThat(actual).isCloseTo(240.0, within(0.0001));
    }

    @Test
    void getOrEstimateRate_whenIncomingRateExceedsMaximum_returnsZeroWithoutEstimate() {
        RateEstimatorRegistry registry = new RateEstimatorRegistry();

        double actual = registry.getOrEstimateRate(null, null, null, null, 1000L, 240.1);

        assertThat(actual).isZero();
    }

    @Test
    void getOrEstimateRate_whenIncomingRateIsNaN_returnsZeroWithoutEstimate() {
        RateEstimatorRegistry registry = new RateEstimatorRegistry();

        double actual = registry.getOrEstimateRate(null, null, null, null, 1000L, Double.NaN);

        assertThat(actual).isZero();
    }

    @Test
    void getOrEstimateRate_whenCompressionIntervalIs249Ms_doesNotEstimateRate() {
        RateEstimatorRegistry registry = new RateEstimatorRegistry();

        startByDepthProgress(registry, 1000L);
        releaseByDepthProgress(registry, 1100L);
        double actual = startByDepthProgress(registry, 1249L);

        assertThat(actual).isZero();
    }

    @Test
    void getOrEstimateRate_whenCompressionIntervalIs250Ms_returns240Cpm() {
        RateEstimatorRegistry registry = new RateEstimatorRegistry();

        startByDepthProgress(registry, 1000L);
        releaseByDepthProgress(registry, 1100L);
        double actual = startByDepthProgress(registry, 1250L);

        assertThat(actual).isCloseTo(240.0, within(0.0001));
    }

    @Test
    void getOrEstimateRate_whenCompressionIntervalIs500Ms_returns120Cpm() {
        RateEstimatorRegistry registry = new RateEstimatorRegistry();

        startByDepthProgress(registry, 1000L);
        releaseByDepthProgress(registry, 1100L);
        double actual = startByDepthProgress(registry, 1500L);

        assertThat(actual).isCloseTo(120.0, within(0.0001));
    }

    @Test
    void getOrEstimateRate_whenCompressionIntervalIs2000Ms_returns30Cpm() {
        RateEstimatorRegistry registry = new RateEstimatorRegistry();

        startByDepthProgress(registry, 1000L);
        releaseByDepthProgress(registry, 1100L);
        double actual = startByDepthProgress(registry, 3000L);

        assertThat(actual).isCloseTo(30.0, within(0.0001));
    }

    @Test
    void getOrEstimateRate_whenCompressionIntervalIs2001Ms_doesNotEstimateRate() {
        RateEstimatorRegistry registry = new RateEstimatorRegistry();

        startByDepthProgress(registry, 1000L);
        releaseByDepthProgress(registry, 1100L);
        double actual = startByDepthProgress(registry, 3001L);

        assertThat(actual).isZero();
    }

    @Test
    void getOrEstimateRate_whenExistingRateBecomesStale_resetsToZero() {
        RateEstimatorRegistry registry = new RateEstimatorRegistry();

        startByDepthProgress(registry, 1000L);
        releaseByDepthProgress(registry, 1100L);
        assertThat(startByDepthProgress(registry, 1500L)).isCloseTo(120.0, within(0.0001));

        double actual = registry.getOrEstimateRate(DEVICE_ID, SESSION_ID, 0.15, null, 3501L, null);

        assertThat(actual).isZero();
    }

    @Test
    void getOrEstimateRate_whenDepthMillimetresAreUsed_estimatesRate() {
        RateEstimatorRegistry registry = new RateEstimatorRegistry();

        startByDepthMm(registry, 1000L);
        releaseByDepthMm(registry, 1100L);
        double actual = startByDepthMm(registry, 1500L);

        assertThat(actual).isCloseTo(120.0, within(0.0001));
    }

    @Test
    void getOrEstimateRate_whenSessionsDiffer_keepsEstimatorStateIndependent() {
        RateEstimatorRegistry registry = new RateEstimatorRegistry();

        startByDepthProgress(registry, "S-A", 1000L);
        releaseByDepthProgress(registry, "S-A", 1100L);
        double sessionARate = startByDepthProgress(registry, "S-A", 1500L);

        double sessionBRate = startByDepthProgress(registry, "S-B", 1500L);

        assertThat(sessionARate).isCloseTo(120.0, within(0.0001));
        assertThat(sessionBRate).isZero();
    }

    private double startByDepthProgress(RateEstimatorRegistry registry, long tsMs) {
        return startByDepthProgress(registry, SESSION_ID, tsMs);
    }

    private double startByDepthProgress(RateEstimatorRegistry registry, String sessionId, long tsMs) {
        return registry.getOrEstimateRate(DEVICE_ID, sessionId, 0.2, null, tsMs, null);
    }

    private double releaseByDepthProgress(RateEstimatorRegistry registry, long tsMs) {
        return releaseByDepthProgress(registry, SESSION_ID, tsMs);
    }

    private double releaseByDepthProgress(RateEstimatorRegistry registry, String sessionId, long tsMs) {
        return registry.getOrEstimateRate(DEVICE_ID, sessionId, 0.1, null, tsMs, null);
    }

    private double startByDepthMm(RateEstimatorRegistry registry, long tsMs) {
        return registry.getOrEstimateRate(DEVICE_ID, SESSION_ID, null, 10.0, tsMs, null);
    }

    private double releaseByDepthMm(RateEstimatorRegistry registry, long tsMs) {
        return registry.getOrEstimateRate(DEVICE_ID, SESSION_ID, null, 5.0, tsMs, null);
    }
}
