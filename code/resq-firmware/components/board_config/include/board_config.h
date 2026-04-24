#pragma once

#include "driver/gpio.h"
#include "hal/adc_types.h"

/* =========================================================
 * Sensor pins
 * ========================================================= */
#define BOARD_HX710_1_SCK      GPIO_NUM_6
#define BOARD_HX710_1_DOUT     GPIO_NUM_7
#define BOARD_HX710_2_SCK      GPIO_NUM_4
#define BOARD_HX710_2_DOUT     GPIO_NUM_5

#define BOARD_HALL_ADC_CHAN    ADC_CHANNEL_2

/* =========================================================
 * Status indicator pins
 * ========================================================= */
#define BOARD_STATUS_LED_GPIO  GPIO_NUM_8
#define BOARD_BUZZER_GPIO      GPIO_NUM_10

/* =========================================================
 * Factory reset button
 * ========================================================= */
#define BOARD_FACTORY_RESET_BUTTON GPIO_NUM_9