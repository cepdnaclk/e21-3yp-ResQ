idf_component_register(
    SRCS
        "main.c"

    INCLUDE_DIRS
        "."

    REQUIRES
        config
        runtime
        error_manager
        runtime_helpers
        provisioning_manager
        wifi_manager
        backend_register_client
        mqtt_manager
        paired_idle_manager
        calibration_manager
        calibration_state_manager
        nvs_flash
        esp_event
        esp_netif
        esp_wifi
        esp_timer
        freertos
)