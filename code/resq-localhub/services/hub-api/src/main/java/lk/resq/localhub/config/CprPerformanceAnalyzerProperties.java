package lk.resq.localhub.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "resq.cpr-performance")
public class CprPerformanceAnalyzerProperties {

    private double compressionDepthMinMm = 50.0;
    private double compressionDepthMaxMm = 60.0;
    private double compressionRateMinCpm = 100.0;
    private double compressionRateMaxCpm = 120.0;
    private int badPerformanceOverallScoreThreshold = 70;
    private double badPerformanceDepthAccuracyThreshold = 70.0;
    private double badPerformanceRateAccuracyThreshold = 70.0;
    private double recoilErrorThresholdPercent = 15.0;
    private double consistencyScoreThreshold = 70.0;
    private double fatigueDropThresholdPercent = 10.0;
    private int excessivePauseCountThreshold = 2;
    private double excessiveLongestPauseSecondsThreshold = 2.5;

    public double getCompressionDepthMinMm() {
        return compressionDepthMinMm;
    }

    public void setCompressionDepthMinMm(double compressionDepthMinMm) {
        this.compressionDepthMinMm = compressionDepthMinMm;
    }

    public double getCompressionDepthMaxMm() {
        return compressionDepthMaxMm;
    }

    public void setCompressionDepthMaxMm(double compressionDepthMaxMm) {
        this.compressionDepthMaxMm = compressionDepthMaxMm;
    }

    public double getCompressionRateMinCpm() {
        return compressionRateMinCpm;
    }

    public void setCompressionRateMinCpm(double compressionRateMinCpm) {
        this.compressionRateMinCpm = compressionRateMinCpm;
    }

    public double getCompressionRateMaxCpm() {
        return compressionRateMaxCpm;
    }

    public void setCompressionRateMaxCpm(double compressionRateMaxCpm) {
        this.compressionRateMaxCpm = compressionRateMaxCpm;
    }

    public int getBadPerformanceOverallScoreThreshold() {
        return badPerformanceOverallScoreThreshold;
    }

    public void setBadPerformanceOverallScoreThreshold(int badPerformanceOverallScoreThreshold) {
        this.badPerformanceOverallScoreThreshold = badPerformanceOverallScoreThreshold;
    }

    public double getBadPerformanceDepthAccuracyThreshold() {
        return badPerformanceDepthAccuracyThreshold;
    }

    public void setBadPerformanceDepthAccuracyThreshold(double badPerformanceDepthAccuracyThreshold) {
        this.badPerformanceDepthAccuracyThreshold = badPerformanceDepthAccuracyThreshold;
    }

    public double getBadPerformanceRateAccuracyThreshold() {
        return badPerformanceRateAccuracyThreshold;
    }

    public void setBadPerformanceRateAccuracyThreshold(double badPerformanceRateAccuracyThreshold) {
        this.badPerformanceRateAccuracyThreshold = badPerformanceRateAccuracyThreshold;
    }

    public double getRecoilErrorThresholdPercent() {
        return recoilErrorThresholdPercent;
    }

    public void setRecoilErrorThresholdPercent(double recoilErrorThresholdPercent) {
        this.recoilErrorThresholdPercent = recoilErrorThresholdPercent;
    }

    public double getConsistencyScoreThreshold() {
        return consistencyScoreThreshold;
    }

    public void setConsistencyScoreThreshold(double consistencyScoreThreshold) {
        this.consistencyScoreThreshold = consistencyScoreThreshold;
    }

    public double getFatigueDropThresholdPercent() {
        return fatigueDropThresholdPercent;
    }

    public void setFatigueDropThresholdPercent(double fatigueDropThresholdPercent) {
        this.fatigueDropThresholdPercent = fatigueDropThresholdPercent;
    }

    public int getExcessivePauseCountThreshold() {
        return excessivePauseCountThreshold;
    }

    public void setExcessivePauseCountThreshold(int excessivePauseCountThreshold) {
        this.excessivePauseCountThreshold = excessivePauseCountThreshold;
    }

    public double getExcessiveLongestPauseSecondsThreshold() {
        return excessiveLongestPauseSecondsThreshold;
    }

    public void setExcessiveLongestPauseSecondsThreshold(double excessiveLongestPauseSecondsThreshold) {
        this.excessiveLongestPauseSecondsThreshold = excessiveLongestPauseSecondsThreshold;
    }
}