idf_component_register(
    SRCS "runtime_identity.c"
    INCLUDE_DIRS "include"
    REQUIRES esp_system cjson freertos
)
