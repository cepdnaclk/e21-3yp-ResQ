idf_component_register(
    SRCS
        "error_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        runtime
        runtime_helpers
        mqtt_manager
        driver
        freertos
)
