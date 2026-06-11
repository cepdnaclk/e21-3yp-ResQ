idf_component_register(
    SRCS
        "backend_register_client.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        esp_http_client
        cjson
        config
        freertos
)
