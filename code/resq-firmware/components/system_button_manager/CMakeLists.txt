idf_component_register(
    SRCS
        "system_button_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        esp_driver_gpio
        freertos
        esp_timer
)
