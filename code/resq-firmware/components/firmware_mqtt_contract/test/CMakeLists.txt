idf_component_register(
    SRCS
        "test_firmware_mqtt_contract.c"

    INCLUDE_DIRS
        "."

    REQUIRES
        unity
        cjson
        firmware_mqtt_contract
)
