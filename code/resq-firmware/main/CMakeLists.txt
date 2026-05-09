idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES
        sensor_runtime
        app_config
        provisioning
        network
        messaging
        event_publisher
        protocol
        runtime
        device_identity
        board_config
        calibration_manager
)