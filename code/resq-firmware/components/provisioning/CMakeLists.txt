idf_component_register(
    SRCS "provision_ap.c"
    INCLUDE_DIRS "include"
    REQUIRES app_config esp_wifi esp_event esp_netif esp_http_server freertos
)