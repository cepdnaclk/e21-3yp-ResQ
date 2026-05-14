idf_component_register(
    SRCS "hx710.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_driver_gpio freertos esp_rom
)