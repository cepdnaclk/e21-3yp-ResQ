idf_component_register(
    SRCS
        "session_manager.c"
        "health_monitor.c"
    INCLUDE_DIRS "include"
    REQUIRES
        freertos
        sensor_runtime
        messaging
        network
        app_config
)