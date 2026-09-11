idf_component_register(
    SRCS
        "test_sensor_owner.c"

    INCLUDE_DIRS
        "."

    REQUIRES
        unity
        sensor_owner
        freertos
)
