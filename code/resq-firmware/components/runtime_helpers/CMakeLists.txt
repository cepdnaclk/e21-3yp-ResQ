idf_component_register(
    SRCS
        "runtime_helpers.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        mqtt_manager
        esp_timer
)
