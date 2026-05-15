idf_component_register(
    SRCS
        "cpr_metrics.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        freertos
        esp_timer
)
