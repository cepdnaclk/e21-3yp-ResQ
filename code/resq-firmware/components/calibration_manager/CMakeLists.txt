idf_component_register(
    SRCS
        "calibration_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        runtime
        hx710
        hall_sensor
        driver
        freertos
        mqtt_manager
        runtime_helpers
        esp_timer
)