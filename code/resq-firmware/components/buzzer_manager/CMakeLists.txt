idf_component_register(
    SRCS
        "buzzer_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        esp_driver_gpio
        freertos
)
