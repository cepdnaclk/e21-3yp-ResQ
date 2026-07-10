idf_component_register(
    SRCS
        "test_telemetry_payload.c"

    INCLUDE_DIRS
        "."

    REQUIRES
        unity
        telemetry_publisher
)
