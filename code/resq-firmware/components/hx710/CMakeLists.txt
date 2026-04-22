idf_component_register(
    SRCS "hx710.c"
    INCLUDE_DIRS "include"
    REQUIRES driver freertos esp_driver_gpio 
)