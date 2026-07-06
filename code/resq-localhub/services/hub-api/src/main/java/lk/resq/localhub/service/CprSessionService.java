package lk.resq.localhub.service;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.stereotype.Service;

import lk.resq.localhub.model.cpr.CprSessionSummaryQueryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryRequest;
import lk.resq.localhub.model.cpr.CprSessionSummaryResponse;

@Service
public class CprSessionService {

    private final LocalSessionRepository localSessionRepository;

    public CprSessionService(LocalSessionRepository localSessionRepository) {
        this.localSessionRepository = localSessionRepository;
    }

    public CprSessionSummaryResponse save(CprSessionSummaryRequest request) {
        String id = normalizeRequired(request.id(), "id");
        String userId = normalizeOptional(request.userId());
        String traineeId = normalizeOptional(request.traineeId());
        String manikinId = normalizeRequired(request.manikinId(), "manikinId");
        Instant startedAt = requireInstant(request.startedAt(), "startedAt");
        Instant endedAt = requireInstant(request.endedAt(), "endedAt");

        if (userId == null && traineeId == null) {
            throw new IllegalArgumentException("userId or traineeId is required");
        }
        if (!endedAt.isAfter(startedAt)) {
            throw new IllegalArgumentException("endedAt must be after startedAt");
        }

        requirePositive(request.durationSeconds(), "durationSeconds");
        requireNonNegative(request.avgDepthMm(), "avgDepthMm");
        requireNonNegative(request.minDepthMm(), "minDepthMm");
        requireNonNegative(request.maxDepthMm(), "maxDepthMm");
        requirePercentage(request.depthAccuracyPercent(), "depthAccuracyPercent");
        requireNonNegative(request.avgRateCpm(), "avgRateCpm");
        requirePercentage(request.rateAccuracyPercent(), "rateAccuracyPercent");
        requirePercentage(request.recoilErrorPercent(), "recoilErrorPercent");
        requireNonNegative(request.pauseCount(), "pauseCount");
        requireNonNegative(request.longestPauseSeconds(), "longestPauseSeconds");
        requirePercentage(request.consistencyScore(), "consistencyScore");
        requirePercentage(request.fatigueDropPercent(), "fatigueDropPercent");
        requirePercentage(request.overallScore(), "overallScore");

        if (request.maxDepthMm() < request.minDepthMm()) {
            throw new IllegalArgumentException("maxDepthMm must be greater than or equal to minDepthMm");
        }

        String storedUserId = userId != null ? userId : traineeId;

        CprSessionSummaryRequest normalizedRequest = new CprSessionSummaryRequest(
                id,
            storedUserId,
                traineeId,
                manikinId,
                startedAt,
                endedAt,
                request.durationSeconds(),
                request.avgDepthMm(),
                request.minDepthMm(),
                request.maxDepthMm(),
                request.depthAccuracyPercent(),
                request.avgRateCpm(),
                request.rateAccuracyPercent(),
                request.recoilErrorPercent(),
                request.pauseCount(),
                request.longestPauseSeconds(),
                request.consistencyScore(),
                request.fatigueDropPercent(),
                request.overallScore()
        );

        Instant createdAt = Instant.now();
        localSessionRepository.saveCprSession(normalizedRequest, createdAt);
        return toResponse(normalizedRequest, createdAt);
    }

    public List<CprSessionSummaryResponse> list(CprSessionSummaryQueryRequest query) {
        Instant from = parseOptionalInstant(query.from(), "from");
        Instant to = parseOptionalInstant(query.to(), "to");

        if (from != null && to != null && from.isAfter(to)) {
            throw new IllegalArgumentException("from must be before or equal to to");
        }

        CprSessionSummaryQueryRequest normalizedQuery = new CprSessionSummaryQueryRequest(
                normalizeOptional(query.userId()),
                normalizeOptional(query.traineeId()),
                from == null ? null : from.toString(),
                to == null ? null : to.toString(),
                normalizeOptional(query.manikinId())
        );

        return localSessionRepository.findCprSessions(normalizedQuery);
    }

    public Optional<CprSessionSummaryResponse> findById(String id) {
        String normalizedId = normalizeRequired(id, "id");
        return localSessionRepository.findCprSessionById(normalizedId);
    }

    private static CprSessionSummaryResponse toResponse(CprSessionSummaryRequest request, Instant createdAt) {
        return new CprSessionSummaryResponse(
                request.id(),
                request.userId() != null ? request.userId() : request.traineeId(),
                request.traineeId(),
                request.manikinId(),
                request.startedAt(),
                request.endedAt(),
                request.durationSeconds(),
                request.avgDepthMm(),
                request.minDepthMm(),
                request.maxDepthMm(),
                request.depthAccuracyPercent(),
                request.avgRateCpm(),
                request.rateAccuracyPercent(),
                request.recoilErrorPercent(),
                request.pauseCount(),
                request.longestPauseSeconds(),
                request.consistencyScore(),
                request.fatigueDropPercent(),
                request.overallScore(),
                createdAt
        );
    }

    private static String normalizeRequired(String value, String fieldName) {
        String normalized = normalizeOptional(value);
        if (normalized == null) {
            throw new IllegalArgumentException(fieldName + " is required");
        }
        return normalized;
    }

    private static String normalizeOptional(String value) {
        if (value == null) {
            return null;
        }

        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }

    private static Instant requireInstant(Instant value, String fieldName) {
        if (value == null) {
            throw new IllegalArgumentException(fieldName + " is required");
        }
        return value;
    }

    private static void requirePositive(long value, String fieldName) {
        if (value <= 0) {
            throw new IllegalArgumentException(fieldName + " must be positive");
        }
    }

    private static void requireNonNegative(double value, String fieldName) {
        if (value < 0.0) {
            throw new IllegalArgumentException(fieldName + " must not be negative");
        }
    }

    private static void requireNonNegative(int value, String fieldName) {
        if (value < 0) {
            throw new IllegalArgumentException(fieldName + " must not be negative");
        }
    }

    private static void requirePercentage(double value, String fieldName) {
        if (value < 0.0 || value > 100.0) {
            throw new IllegalArgumentException(fieldName + " must be between 0 and 100");
        }
    }

    private static Instant parseOptionalInstant(String value, String fieldName) {
        if (value == null || value.isBlank()) {
            return null;
        }

        try {
            return Instant.parse(value.trim());
        } catch (Exception error) {
            throw new IllegalArgumentException(fieldName + " must be an ISO-8601 instant", error);
        }
    }
}