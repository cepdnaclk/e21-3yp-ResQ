#include <stdio.h>

#include "unity.h"

extern void resq_raw_sensor_output_tests_link_anchor(void);

void app_main(void)
{
    printf("\nResQ firmware Unity test application\n");
    resq_raw_sensor_output_tests_link_anchor();
    unity_run_menu();
}
