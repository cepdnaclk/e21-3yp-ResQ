idf_component_register(
    SRCS
        "paired_idle_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        runtime
        runtime_helpers
        mqtt_manager
        wifi_manager
        hx710
        hall_sensor
        cjson
        esp_timer
        freertos
)
