#pragma once

#include "driver/gpio.h"
#include "hal/adc_types.h"

/* =========================================================
 * Sensor pins
 * ========================================================= */
#define BOARD_HX710_0_SCK      GPIO_NUM_18      // Reference pressure sensor
#define BOARD_HX710_0_DOUT     GPIO_NUM_19
#define BOARD_HX710_1_SCK      GPIO_NUM_6       // Bladder 1 pressure sensor - Left bladder
#define BOARD_HX710_1_DOUT     GPIO_NUM_7
#define BOARD_HX710_2_SCK      GPIO_NUM_4       // Bladder 2 pressure sensor - Right bladder
#define BOARD_HX710_2_DOUT     GPIO_NUM_5

#define BOARD_HALL_ADC_CHAN    ADC_CHANNEL_2

/* =========================================================
 * Status indicator pins
 * ========================================================= */
#define BOARD_STATE_LED        GPIO_NUM_8
#define BOARD_ACTIVITY_LED     GPIO_NUM_3
#define BOARD_BUZZER_GPIO      GPIO_NUM_10

/* =========================================================
 * Factory reset button
 * ========================================================= */
#define BUTTON_1                GPIO_NUM_9
#define BUTTON_2                GPIO_NUM_1  