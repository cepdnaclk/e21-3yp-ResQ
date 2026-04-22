idf_component_register(
    SRCS
        "mqtt_manager.c"
        "telemetry_publisher.c"
    INCLUDE_DIRS "include"
    REQUIRES
        espressif__mqtt
        espressif__cjson
        app_config
        sensor_runtime
        runtime
        freertos
)