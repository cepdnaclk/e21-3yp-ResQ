package lk.resq.localhub.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CprScoringCalculatorTest {
    private final CprScoringConfig config = CprScoringConfig.moderateV1();

    @Test void bandScoringCoversIdealShallowDeepSlowFastAndBoundaries() {
        assertThat(CprScoringCalculator.bandScore(55, config.depth())).isEqualTo(100);
        assertThat(CprScoringCalculator.bandScore(45, config.depth())).isCloseTo(66.67, within());
        assertThat(CprScoringCalculator.bandScore(65, config.depth())).isCloseTo(66.67, within());
        assertThat(CprScoringCalculator.bandScore(35, config.depth())).isZero();
        assertThat(CprScoringCalculator.bandScore(75, config.depth())).isZero();
        assertThat(CprScoringCalculator.bandScore(110, config.rate())).isEqualTo(100);
        assertThat(CprScoringCalculator.bandScore(90, config.rate())).isCloseTo(66.67, within());
        assertThat(CprScoringCalculator.bandScore(130, config.rate())).isCloseTo(66.67, within());
        assertThat(CprScoringCalculator.bandScore(70, config.rate())).isZero();
        assertThat(CprScoringCalculator.bandScore(150, config.rate())).isZero();
    }

    @Test void qualityAndCompressionFractionInterpolationAreGradual() {
        assertThat(CprScoringCalculator.qualityPercentScore(40, config.recoil())).isZero();
        assertThat(CprScoringCalculator.qualityPercentScore(50, config.recoil())).isEqualTo(30);
        assertThat(CprScoringCalculator.qualityPercentScore(60, config.handPlacement())).isEqualTo(60);
        assertThat(CprScoringCalculator.qualityPercentScore(75, config.handPlacement())).isEqualTo(80);
        assertThat(CprScoringCalculator.qualityPercentScore(90, config.recoil())).isEqualTo(100);
        assertThat(CprScoringCalculator.compressionFractionScore(40, config.compressionFraction())).isZero();
        assertThat(CprScoringCalculator.compressionFractionScore(60, config.compressionFraction())).isEqualTo(50);
        assertThat(CprScoringCalculator.compressionFractionScore(70, config.compressionFraction())).isEqualTo(75);
        assertThat(CprScoringCalculator.compressionFractionScore(80, config.compressionFraction())).isEqualTo(100);
    }

    @Test void weightedTotalVersionAndGradeAreExact() {
        var result = CprScoringCalculator.score(new CprScoringCalculator.Input(
                47.75, 97, 71.25, 75, 68, 20));
        assertThat(result.version()).isEqualTo("moderate-v1");
        assertThat(result.overallScore()).isEqualTo(82);
        assertThat(result.grade()).isEqualTo("Good");
        assertThat(result.provisional()).isFalse();
    }

    @Test void criticalCapsExposeEveryReason() {
        var result = CprScoringCalculator.score(new CprScoringCalculator.Input(
                38, 75, 100, 100, 30, 20));
        assertThat(result.overallScore()).isLessThanOrEqualTo(59);
        assertThat(result.scoreCap()).isEqualTo(59);
        assertThat(result.scoreCapReason()).contains("depth", "rate", "compression fraction");
    }

    @Test void insufficientEvidenceIsProvisionalAndMissingEvidenceIsUnavailable() {
        assertThat(CprScoringCalculator.score(new CprScoringCalculator.Input(
                55, 110, 95, 95, 85, 9)).provisional()).isTrue();
        var unavailable = CprScoringCalculator.score(new CprScoringCalculator.Input(
                Double.NaN, 110, 95, 95, 85, 20));
        assertThat(unavailable.overallScore()).isNull();
        assertThat(unavailable.grade()).isEqualTo("Unavailable");
    }

    @Test void configurationValidationRejectsBadWeightsRangesAndGrades() {
        var valid = config;
        assertThat(valid.weights().total()).isEqualTo(1.0);
        assertThatThrownBy(() -> new CprScoringConfig(
                "bad", new CprScoringConfig.Weights(.3, .25, .2, .15, .2),
                valid.depth(), valid.rate(), valid.recoil(), valid.handPlacement(),
                valid.compressionFraction(), 10, valid.caps(), valid.grades()).validated())
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("weights");
        assertThatThrownBy(() -> new CprScoringConfig(
                "bad", valid.weights(), new CprScoringConfig.Band(30, 60, 35, 75),
                valid.rate(), valid.recoil(), valid.handPlacement(), valid.compressionFraction(),
                10, valid.caps(), valid.grades()).validated())
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new CprScoringConfig(
                "bad", valid.weights(), valid.depth(), valid.rate(), valid.recoil(),
                valid.handPlacement(), valid.compressionFraction(), 10, valid.caps(),
                List.of(new CprScoringConfig.GradeBand(0, 100, "A"),
                        new CprScoringConfig.GradeBand(90, 100, "B"))).validated())
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("overlap");
    }

    @Test void extremeFiniteInputsNeverOverflowOrProduceNan() {
        var result = CprScoringCalculator.score(new CprScoringCalculator.Input(
                Double.MAX_VALUE, -Double.MAX_VALUE, 1e300, -1e300, 1e300, Integer.MAX_VALUE));
        assertThat(result.overallScore()).isBetween(0, 100);
        assertThat(result.depthScore()).isFinite();
        assertThat(result.rateScore()).isFinite();
    }

    private static org.assertj.core.data.Offset<Double> within() {
        return org.assertj.core.data.Offset.offset(0.01);
    }
}
