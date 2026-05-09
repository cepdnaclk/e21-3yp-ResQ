idf_component_register(
    SRCS "event_publisher.c"
    INCLUDE_DIRS "include"
    REQUIRES
        app_config
        messaging
        protocol
        freertos
        espressif__cjson
)
