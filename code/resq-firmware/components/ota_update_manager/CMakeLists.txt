idf_component_register(
    SRCS
        "ota_update_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        app_update
        esp_app_format
        esp_http_server
        esp_timer
        freertos
        cjson
        config
        mqtt_manager
)
