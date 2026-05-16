idf_component_register(
    SRCS
        "calibration_fail_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        runtime
        runtime_helpers
        mqtt_manager
        calibration_manager
        wifi_manager
        esp_driver_gpio
        freertos
)
