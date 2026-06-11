idf_component_register(
    SRCS "hall_sensor.c"
    INCLUDE_DIRS "include"
    REQUIRES adc_shared_service config
)