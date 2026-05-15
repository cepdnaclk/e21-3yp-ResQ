idf_component_register(
    SRCS
        "session_manager.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        freertos
        esp_timer
)
