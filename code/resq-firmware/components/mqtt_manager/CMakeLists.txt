idf_component_register(
    SRCS
        "mqtt_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        mqtt
        cjson
        config
        esp_timer
        runtime
        runtime_identity
        freertos
)
