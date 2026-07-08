idf_component_register(
    SRCS
        "test_sensor_conversion.c"

    INCLUDE_DIRS
        "."

    REQUIRES
        unity
        sensor_conversion
        config
)
