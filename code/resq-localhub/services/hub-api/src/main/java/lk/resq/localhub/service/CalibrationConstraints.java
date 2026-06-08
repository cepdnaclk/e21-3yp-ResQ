package lk.resq.localhub.service;

final class CalibrationConstraints {

    static final int DEFAULT_HALL_DELTA = 620;
    static final int MIN_HALL_DELTA = 50;
    static final int MAX_HALL_DELTA = 4095;

    private CalibrationConstraints() {
    }

    static Integer requireHallDelta(Integer value) {
        if (value == null || value < MIN_HALL_DELTA || value > MAX_HALL_DELTA) {
            throw new IllegalArgumentException(
                    "hallDelta must be between " + MIN_HALL_DELTA + " and " + MAX_HALL_DELTA
            );
        }
        return value;
    }
}
