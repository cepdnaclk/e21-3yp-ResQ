idf_component_register(
    SRCS "sensor_runtime.c"
    INCLUDE_DIRS "include"
    REQUIRES
        cpr_logic
        hall_sensor
        hx710
        app_config
        board_config
        freertos
        event_publisher
    PRIV_REQUIRES
        esp_timer
        runtime
)
