idf_component_register(
    SRCS
        "calibration_state_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        calibration_manager
        mqtt_manager
        runtime_helpers
        runtime
        esp_timer
        error_manager
        freertos
        system_button_manager
)
