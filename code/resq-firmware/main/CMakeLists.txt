idf_component_register(
    SRCS
        "main.c"

    INCLUDE_DIRS
        "."

    REQUIRES
        config
        runtime
        provisioning_manager
        wifi_manager
        backend_register_client
        mqtt_manager
        freertos
)