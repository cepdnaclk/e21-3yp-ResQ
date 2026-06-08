idf_component_register(
    SRCS
        "firmware_state_machine.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        config
        backend_register_client
        error_manager
        session_manager
        system_button_manager
        wifi_manager
)
