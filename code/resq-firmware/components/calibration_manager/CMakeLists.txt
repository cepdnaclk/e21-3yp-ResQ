idf_component_register(
    SRCS "calibration_manager.c"
    INCLUDE_DIRS "include"
    REQUIRES 
        app_config 
        sensor_runtime 
        esp_timer 
        freertos
        log
)