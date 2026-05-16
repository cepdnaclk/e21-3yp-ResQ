idf_component_register(
    SRCS
        "config_store.c"
        "resq_config_types.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        nvs_flash
        esp_hw_support
        esp_driver_gpio
)