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
        telemetry_publisher
        esp_driver_gpio
        system_button_manager
        esp_timer
        freertos
    PRIV_REQUIRES
        system_button_manager
)
