idf_component_register(
    SRCS
        "test_main.c"
        "test_raw_sensor_outputs.c"
    INCLUDE_DIRS "."
    PRIV_REQUIRES
        unity
        hall_sensor
        hx710
        config
        freertos
)
