idf_component_register(
    SRCS
        "test_cpr_metrics.c"
        "test_sensor_working_condition.c"
    INCLUDE_DIRS "."
    REQUIRES unity cpr_metrics
)
