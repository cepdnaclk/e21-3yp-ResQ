idf_component_register(
    SRCS
        "session_active_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        runtime
        runtime_helpers
        mqtt_manager
        session_manager
        cpr_metrics
        telemetry_publisher
        buzzer_manager
        calibration_manager
        hx710
        hall_sensor
        wifi_manager
        esp_timer
        freertos
        cjson
        system_button_manager
        error_manager
)
