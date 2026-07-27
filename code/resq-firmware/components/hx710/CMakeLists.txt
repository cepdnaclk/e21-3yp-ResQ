idf_component_register(
    SRCS "hx710.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_driver_gpio esp_timer freertos esp_rom esp_hal_usb io_mode_manager
)
