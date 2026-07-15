idf_component_register(
    SRCS "test_io_mode_manager.c"
    INCLUDE_DIRS "."
    REQUIRES unity io_mode_manager config nvs_flash hx710
)
