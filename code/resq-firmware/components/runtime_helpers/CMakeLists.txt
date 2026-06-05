idf_component_register(
    SRCS
        "runtime_helpers.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        mqtt_manager
        esp_timer
        hx710
        hall_sensor
        esp_driver_gpio
        esp_app_format
        ota_update_manager
        session_manager
        wifi_manager
)
