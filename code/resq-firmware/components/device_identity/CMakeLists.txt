idf_component_register(
    SRCS "device_identity.c"
    INCLUDE_DIRS "include"
    REQUIRES
        esp_system
        esp_app_format
        freertos
)