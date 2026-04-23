idf_component_register(
    SRCS
        "session_manager.c"
        "health_monitor.c"
        "fault_reporter.c"
        "command_handler.c"
        "device_control.c"
    INCLUDE_DIRS "include"
    REQUIRES
        freertos
        sensor_runtime
        messaging
        network
        app_config
        protocol
        esp_system
)