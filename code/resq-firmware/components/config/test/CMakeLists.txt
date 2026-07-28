idf_component_register(
    SRCS "test_config_types.c" "test_io_mode_store.c"
         "test_calibration_store.c"
    INCLUDE_DIRS "."
    REQUIRES unity config nvs_flash calibration_fingerprint
)
