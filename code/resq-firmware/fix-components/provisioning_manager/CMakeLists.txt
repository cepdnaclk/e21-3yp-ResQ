idf_component_register(
    SRCS
        "provisioning_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        esp_wifi
        esp_netif
        esp_event
        esp_http_server
        json
        config
)