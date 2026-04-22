idf_component_register(
    SRCS "sensor_runtime.c"
    INCLUDE_DIRS "include"
    REQUIRES 
        cpr_logic 
        hall_sensor 
        hx710 
)