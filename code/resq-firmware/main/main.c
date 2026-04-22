#include <stdio.h>

#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "cpr_logic.h"
#include "hall_sensor.h"
#include "hx710.h"

// ==================================================
// Pin assignments for the two HX710 force sensors
// ==================================================
#define HX710_1_SCK  GPIO_NUM_6
#define HX710_1_DOUT GPIO_NUM_7
#define HX710_2_SCK  GPIO_NUM_4
#define HX710_2_DOUT GPIO_NUM_5

// ADC channel used for the Hall-effect depth sensor
#define HALL_ADC_CHAN ADC_CHANNEL_2

// ==================================================
// Calibration values for CPR depth detection
// ==================================================
#define HALL_BASELINE 3420
#define HALL_MIN_DELTA 520
#define HALL_MAX_DELTA 1060
#define COMPRESSION_START_DELTA 200

void app_main(void)
{
	// Startup message
	printf("Initializing ResQ Dual Force & Analog Depth System...\n");

	// Initialize both force sensors
	hx710_init(HX710_1_SCK, HX710_1_DOUT);
	hx710_init(HX710_2_SCK, HX710_2_DOUT);

	// Initialize the Hall sensor with its ADC channel and baseline value
	hall_sensor_t hall_sensor;
	ESP_ERROR_CHECK(hall_sensor_init(&hall_sensor, HALL_ADC_CHAN, HALL_BASELINE));

	// Initialize CPR state tracking
	cpr_state_t cpr_state;
	cpr_logic_init(&cpr_state);

	// Set CPR depth thresholds used by the logic module
	cpr_thresholds_t thresholds = {
		.hall_min_delta = HALL_MIN_DELTA,
		.hall_max_delta = HALL_MAX_DELTA,
		.compression_start_delta = COMPRESSION_START_DELTA,
	};

	// Small delay to allow sensors to stabilize before reading
	vTaskDelay(pdMS_TO_TICKS(500));

	while (1) {
		// Read force from sensor 1
		int32_t force1 = hx710_read(HX710_1_SCK, HX710_1_DOUT);

		// Read force from sensor 2
		int32_t force2 = hx710_read(HX710_2_SCK, HX710_2_DOUT);

		// Print force sensor 1 reading or error if disconnected/timed out
		if (force1 != HX710_ERROR_TIMEOUT) {
			printf(">Force_1:%ld\n", force1);
		} else {
			printf("Error: Force Sensor 1 Disconnected!\n");
		}

		// Print force sensor 2 reading or error if disconnected/timed out
		if (force2 != HX710_ERROR_TIMEOUT) {
			printf(">Force_2:%ld\n", force2);
		} else {
			printf("Error: Force Sensor 2 Disconnected!\n");
		}

		// Read raw analog value from the Hall sensor
		int hall_raw = 0;
		ESP_ERROR_CHECK(hall_sensor_read_raw(&hall_sensor, &hall_raw));

		// Convert raw Hall sensor value into a depth delta relative to baseline
		int current_delta = hall_sensor_calculate_delta(&hall_sensor, hall_raw);

		// Print the raw reading and calculated delta
		printf(">Analog_Depth_Raw:%d\n", hall_raw);
		printf(">Current_Delta:%d\n", current_delta);

		// Update CPR logic using the current depth measurement
		cpr_feedback_t feedback = cpr_logic_update(&cpr_state, &thresholds, current_delta);

		// If the CPR state machine produced feedback, print it
		if (feedback != CPR_FEEDBACK_NONE) {
			printf(">Total_Compressions:%d\n", cpr_state.total_compressions);
			printf("--- Compression Evaluated ---\n");
			printf("Feedback: %s\n", cpr_feedback_to_string(feedback));
			printf("----------------------------------\n");
		}

		// Delay between readings to control sampling rate
		vTaskDelay(pdMS_TO_TICKS(20));
	}
}