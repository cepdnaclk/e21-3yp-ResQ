idf_component_register(
    SRCS
        "paired_idle_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        runtime
        runtime_helpers
        calibration_manager
        session_active_manager
        mqtt_manager
        wifi_manager
        hx710
        hall_sensor
        cjson
        esp_timer
        freertos
        error_manager
)
