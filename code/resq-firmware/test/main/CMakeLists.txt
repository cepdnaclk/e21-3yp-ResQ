idf_component_register(
    SRCS
        "test_main.c"
        "test_raw_sensor_outputs.c"
        "test_hx710_diagnostics.c"
    INCLUDE_DIRS "."
    PRIV_REQUIRES
        unity
        hall_sensor
        hx710
        config
        freertos
        io_mode_manager
        sensor_owner
        esp_driver_gpio
)
