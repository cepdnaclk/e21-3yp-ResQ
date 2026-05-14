idf_component_register(
    SRCS "resq_protocol.c"
    INCLUDE_DIRS "include"
    REQUIRES
        espressif__cjson
        sensor_runtime
        calibration_manager
)