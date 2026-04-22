idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES
        sensor_runtime
        app_config
        provisioning
        network
        runtime
        messaging
)