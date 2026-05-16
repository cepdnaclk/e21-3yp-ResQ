idf_component_register(
    SRCS
        "error_manager.c"
        "error_codes.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        runtime
        runtime_helpers
        mqtt_manager
        esp_driver_gpio
        esp_timer
        freertos
)
