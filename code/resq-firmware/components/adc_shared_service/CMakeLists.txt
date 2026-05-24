idf_component_register(
    SRCS "adc_shared_service.c"
    INCLUDE_DIRS "include"
    REQUIRES
        driver
        esp_adc
        config
)
