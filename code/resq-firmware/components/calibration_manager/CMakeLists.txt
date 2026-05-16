idf_component_register(
    SRCS
        "calibration_manager.c"
        "calibration_codes.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        runtime
        hx710
        hall_sensor
        esp_driver_gpio
        cjson
        freertos
        mqtt_manager
        runtime_helpers
        esp_timer
)