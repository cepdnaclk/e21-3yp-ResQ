idf_component_register(
    SRCS
        "telemetry_publisher.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        mqtt_manager
        session_manager
        cpr_metrics
        runtime_helpers
        esp_timer
        freertos
)
