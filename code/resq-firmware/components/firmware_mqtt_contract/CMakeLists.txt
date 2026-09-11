idf_component_register(
    SRCS
        "firmware_mqtt_contract.c"

    INCLUDE_DIRS
        "include"

    REQUIRES
        cjson
        config
)
