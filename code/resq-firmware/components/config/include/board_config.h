#pragma once

#include "driver/gpio.h"
#include "hal/adc_types.h"

/* =========================================================
 * Sensor pins
 * ========================================================= */
#define BOARD_HX710_SHARED_SCK GPIO_NUM_19

/*
 * HX710 pressure sensors use one shared SCK line.
 * Each sensor keeps a separate DOUT line.
 * Do not read these sensors sequentially with hx710_read() using the same SCK.
 * Use hx710_read_3_shared_sck() or the pressure array wrapper.
 */

#define BOARD_HX710_0_DOUT     GPIO_NUM_1
#define BOARD_HX710_1_DOUT     GPIO_NUM_3
#define BOARD_HX710_2_DOUT     GPIO_NUM_10

/* Compatibility aliases - map old per-sensor SCK defines to the shared SCK */
#define BOARD_HX710_0_SCK      BOARD_HX710_SHARED_SCK
#define BOARD_HX710_1_SCK      BOARD_HX710_SHARED_SCK
#define BOARD_HX710_2_SCK      BOARD_HX710_SHARED_SCK

#define BOARD_HALL_ADC_CHAN    ADC_CHANNEL_0

/* =========================================================
 * Status indicator pins
 * ========================================================= */
#define BOARD_STATE_LED        GPIO_NUM_7
#define BOARD_ACTIVITY_LED     GPIO_NUM_6
#define BOARD_BUZZER_GPIO      GPIO_NUM_18

/* =========================================================
 * Factory reset button
 * ========================================================= */
#define BUTTON_1                GPIO_NUM_4
#define BUTTON_2                GPIO_NUM_5