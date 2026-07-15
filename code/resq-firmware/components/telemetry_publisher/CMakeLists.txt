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
        config
        hall_sensor
        hx710
        sensor_conversion
        sensor_owner
        io_mode_manager
        esp_timer
        freertos
)
