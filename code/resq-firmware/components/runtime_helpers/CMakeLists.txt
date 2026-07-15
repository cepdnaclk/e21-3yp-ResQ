idf_component_register(
    SRCS
        "runtime_helpers.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        mqtt_manager
        runtime_identity
        esp_timer
        hx710
        hall_sensor
        sensor_conversion
        sensor_owner
        io_mode_manager
        esp_driver_gpio
)
