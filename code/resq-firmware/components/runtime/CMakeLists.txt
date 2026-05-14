idf_component_register(
    SRCS
        "status_indicator.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        esp_driver_gpio
        freertos
)