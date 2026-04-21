#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>

#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_err.h"
#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

// ==========================================
// PIN DEFINITIONS (ESP32-C3)
// ==========================================
// Dual Force/Pressure Sensors (HX710B)
#define HX710_1_SCK  GPIO_NUM_6
#define HX710_1_DOUT GPIO_NUM_7
#define HX710_2_SCK  GPIO_NUM_4
#define HX710_2_DOUT GPIO_NUM_5

// Analog Hall Sensor (HW-484 on GPIO 2)
#define HALL_ADC_CHAN ADC_CHANNEL_2

// ==========================================
// CPR DEPTH CALIBRATION (HW-484)
// ==========================================
const int HALL_BASELINE = 3420;
const int HALL_MIN_DELTA = 520;
const int HALL_MAX_DELTA = 1060;
const int COMPRESSION_START_DELTA = 200;
// ==========================================

void hx710_init(gpio_num_t sck_pin, gpio_num_t dout_pin)
{
	gpio_reset_pin(sck_pin);
	gpio_set_direction(sck_pin, GPIO_MODE_OUTPUT);
	gpio_set_level(sck_pin, 0);

	gpio_reset_pin(dout_pin);
	gpio_set_direction(dout_pin, GPIO_MODE_INPUT);
}

int32_t hx710_read(gpio_num_t sck_pin, gpio_num_t dout_pin)
{
	int timeout_ticks = 0;
	const int MAX_WAIT_TICKS = 50;

	while (gpio_get_level(dout_pin) == 1) {
		vTaskDelay(1);
		timeout_ticks++;
		if (timeout_ticks > MAX_WAIT_TICKS) {
			return -999999;
		}
	}

	int32_t raw_data = 0;

	for (int i = 0; i < 24; i++) {
		gpio_set_level(sck_pin, 1);
		esp_rom_delay_us(1);

		raw_data = raw_data << 1;

		gpio_set_level(sck_pin, 0);
		esp_rom_delay_us(1);

		if (gpio_get_level(dout_pin)) {
			raw_data++;
		}
	}

	gpio_set_level(sck_pin, 1);
	esp_rom_delay_us(1);
	gpio_set_level(sck_pin, 0);
	esp_rom_delay_us(1);

	if (raw_data & 0x800000) {
		raw_data |= 0xFF000000;
	}

	return raw_data;
}

void app_main(void)
{
	printf("Initializing ResQ Dual Force & Analog Depth System...\n");

	hx710_init(HX710_1_SCK, HX710_1_DOUT);
	hx710_init(HX710_2_SCK, HX710_2_DOUT);

	adc_oneshot_unit_handle_t adc1_handle;
	adc_oneshot_unit_init_cfg_t init_config1 = {
		.unit_id = ADC_UNIT_1,
	};
	ESP_ERROR_CHECK(adc_oneshot_new_unit(&init_config1, &adc1_handle));

	adc_oneshot_chan_cfg_t config = {
		.bitwidth = ADC_BITWIDTH_DEFAULT,
		.atten = ADC_ATTEN_DB_12,
	};
	ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, HALL_ADC_CHAN, &config));

	vTaskDelay(pdMS_TO_TICKS(500));

	bool is_compressing = false;
	int peak_delta = 0;
	int total_compressions = 0;

	while (1) {
		int32_t force1 = hx710_read(HX710_1_SCK, HX710_1_DOUT);
		int32_t force2 = hx710_read(HX710_2_SCK, HX710_2_DOUT);

		if (force1 != -999999) {
			printf(">Force_1:%ld\n", force1);
		} else {
			printf("Error: Force Sensor 1 Disconnected!\n");
		}

		if (force2 != -999999) {
			printf(">Force_2:%ld\n", force2);
		} else {
			printf("Error: Force Sensor 2 Disconnected!\n");
		}

		int current_adc;
		ESP_ERROR_CHECK(adc_oneshot_read(adc1_handle, HALL_ADC_CHAN, &current_adc));

		int current_delta = abs(current_adc - HALL_BASELINE);

		printf(">Analog_Depth_Raw:%d\n", current_adc);
		printf(">Current_Delta:%d\n", current_delta);

		if (current_delta > COMPRESSION_START_DELTA) {
			is_compressing = true;

			if (current_delta > peak_delta) {
				peak_delta = current_delta;
			}
		} else if (is_compressing && current_delta < COMPRESSION_START_DELTA) {
			total_compressions++;
			printf(">Total_Compressions:%d\n", total_compressions);
			printf("--- Compression Evaluated ---\n");

			if (peak_delta < HALL_MIN_DELTA) {
				printf("Feedback: TOO SHALLOW (Peak Delta: %d)\n", peak_delta);
			} else if (peak_delta > HALL_MAX_DELTA) {
				printf("Feedback: TOO DEEP (Peak Delta: %d)\n", peak_delta);
			} else {
				printf("Feedback: PERFECT DEPTH! (Peak Delta: %d)\n", peak_delta);
			}
			printf("----------------------------------\n");

			is_compressing = false;
			peak_delta = 0;
		}

		vTaskDelay(pdMS_TO_TICKS(20));
	}
}