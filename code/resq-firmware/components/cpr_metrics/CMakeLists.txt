idf_component_register(
    SRCS
        "cpr_metrics.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        sensor_conversion
        freertos
        esp_timer
)
