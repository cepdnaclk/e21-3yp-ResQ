#include "hx710.h"

#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_log.h"

esp_err_t hx710_init(gpio_num_t sck_pin, gpio_num_t dout_pin)
{
  esp_err_t err;

  /* Validate GPIO arguments */
  if (!GPIO_IS_VALID_OUTPUT_GPIO(sck_pin)) {
    return ESP_ERR_INVALID_ARG;
  }

  if (!GPIO_IS_VALID_GPIO(dout_pin)) {
    return ESP_ERR_INVALID_ARG;
  }

  if (sck_pin == dout_pin) {
    return ESP_ERR_INVALID_ARG;
  }

  /* Configure SCK as output and keep it LOW when idle */
  err = gpio_reset_pin(sck_pin);
  if (err != ESP_OK) {
    return err;
  }

  err = gpio_set_direction(sck_pin, GPIO_MODE_OUTPUT);
  if (err != ESP_OK) {
    return err;
  }

  err = gpio_set_level(sck_pin, 0);
  if (err != ESP_OK) {
    return err;
  }

  /* Configure DOUT as input */
  err = gpio_reset_pin(dout_pin);
  if (err != ESP_OK) {
    return err;
  }

  err = gpio_set_direction(dout_pin, GPIO_MODE_INPUT);
  if (err != ESP_OK) {
    return err;
  }

  return ESP_OK;
}

int32_t hx710_read(gpio_num_t sck_pin, gpio_num_t dout_pin)
{
  int timeout_ticks = 0;
  const int max_wait_ticks = 50;

  while (gpio_get_level(dout_pin) == 1) {
    vTaskDelay(1);
    timeout_ticks++;

    if (timeout_ticks > max_wait_ticks) {
      return HX710_ERROR_TIMEOUT;
    }
  }

  int32_t raw_data = 0;

  for (int i = 0; i < 24; i++) {
    gpio_set_level(sck_pin, 1);
    esp_rom_delay_us(1);

    raw_data <<= 1;

    gpio_set_level(sck_pin, 0);
    esp_rom_delay_us(1);

    if (gpio_get_level(dout_pin)) {
      raw_data++;
    }
  }

  /* Extra clock pulse to complete HX710 read cycle */
  gpio_set_level(sck_pin, 1);
  esp_rom_delay_us(1);
  gpio_set_level(sck_pin, 0);
  esp_rom_delay_us(1);

  /* Sign extend 24-bit two's complement value */
  if (raw_data & 0x800000) {
    raw_data |= 0xFF000000;
  }

  return raw_data;
}

static const char *TAG = "hx710";

static SemaphoreHandle_t s_hx710_mutex = NULL;

static void hx710_ensure_mutex(void)
{
  if (s_hx710_mutex == NULL) {
    s_hx710_mutex = xSemaphoreCreateMutex();
  }
}

static int32_t hx710_sign_extend_24(uint32_t raw)
{
  if (raw & 0x800000) {
    raw |= 0xFF000000;
  }
  return (int32_t)raw;
}

/**
 * Read three HX710 sensors sharing one SCK line in a single synchronized transaction.
 */
esp_err_t hx710_read_3_shared_sck(gpio_num_t sck_pin,
                                  gpio_num_t dout0_pin,
                                  gpio_num_t dout1_pin,
                                  gpio_num_t dout2_pin,
                                  int32_t *out0,
                                  int32_t *out1,
                                  int32_t *out2)
{
  if (out0 == NULL || out1 == NULL || out2 == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  if (!GPIO_IS_VALID_OUTPUT_GPIO(sck_pin) ||
      !GPIO_IS_VALID_GPIO(dout0_pin) ||
      !GPIO_IS_VALID_GPIO(dout1_pin) ||
      !GPIO_IS_VALID_GPIO(dout2_pin)) {
    return ESP_ERR_INVALID_ARG;
  }

  hx710_ensure_mutex();
  if (s_hx710_mutex == NULL) {
    return ESP_ERR_NO_MEM;
  }

  if (xSemaphoreTake(s_hx710_mutex, pdMS_TO_TICKS(200)) != pdTRUE) {
    return ESP_ERR_TIMEOUT;
  }
  /* Validate pins: sck must be distinct from dout pins and dout pins must be unique */
  if (sck_pin == dout0_pin || sck_pin == dout1_pin || sck_pin == dout2_pin ||
      dout0_pin == dout1_pin || dout0_pin == dout2_pin || dout1_pin == dout2_pin) {
    ESP_LOGW(TAG, "Invalid HX710 pin configuration: duplicate pins");
    xSemaphoreGive(s_hx710_mutex);
    return ESP_ERR_INVALID_ARG;
  }

  /* Configure shared SCK as output and the three DOUTs as inputs using gpio_config()
   * to avoid resetting pins and disturbing unrelated GPIO state. */
  esp_err_t err;
  uint64_t sck_mask = (1ULL << sck_pin);
  uint64_t dout_mask = (1ULL << dout0_pin) | (1ULL << dout1_pin) | (1ULL << dout2_pin);

  gpio_config_t sck_conf = {
    .pin_bit_mask = sck_mask,
    .mode = GPIO_MODE_OUTPUT,
    .pull_up_en = GPIO_PULLUP_DISABLE,
    .pull_down_en = GPIO_PULLDOWN_DISABLE,
    .intr_type = GPIO_INTR_DISABLE
  };

  err = gpio_config(&sck_conf);
  if (err != ESP_OK) goto _cleanup;

  err = gpio_set_level(sck_pin, 0);
  if (err != ESP_OK) goto _cleanup;

  gpio_config_t dout_conf = {
    .pin_bit_mask = dout_mask,
    .mode = GPIO_MODE_INPUT,
    .pull_up_en = GPIO_PULLUP_DISABLE,
    .pull_down_en = GPIO_PULLDOWN_DISABLE,
    .intr_type = GPIO_INTR_DISABLE
  };

  err = gpio_config(&dout_conf);
  if (err != ESP_OK) goto _cleanup;

  /* Wait until all three DOUT pins go low (sensor ready) */
  int timeout_ticks = 0;
  const int max_wait_ticks = 50;

  while (gpio_get_level(dout0_pin) == 1 ||
         gpio_get_level(dout1_pin) == 1 ||
         gpio_get_level(dout2_pin) == 1) {
    vTaskDelay(1);
    timeout_ticks++;
    if (timeout_ticks > max_wait_ticks) {
      ESP_LOGW(TAG, "Timeout waiting for all HX710 sensors ready");
      err = ESP_ERR_TIMEOUT;
      goto _cleanup;
    }
  }

  uint32_t raw0 = 0, raw1 = 0, raw2 = 0;

  /* Sample while SCK is HIGH: shift, raise SCK, read DOUTs, then lower SCK. */
  for (int i = 0; i < 24; i++) {
    raw0 <<= 1;
    raw1 <<= 1;
    raw2 <<= 1;

    gpio_set_level(sck_pin, 1);
    esp_rom_delay_us(1);

    if (gpio_get_level(dout0_pin)) {
      raw0 |= 1;
    }
    if (gpio_get_level(dout1_pin)) {
      raw1 |= 1;
    }
    if (gpio_get_level(dout2_pin)) {
      raw2 |= 1;
    }

    gpio_set_level(sck_pin, 0);
    esp_rom_delay_us(1);
  }

  /* Extra clock pulse to complete HX710 read cycle */
  gpio_set_level(sck_pin, 1);
  esp_rom_delay_us(1);
  gpio_set_level(sck_pin, 0);
  esp_rom_delay_us(1);

  *out0 = hx710_sign_extend_24(raw0);
  *out1 = hx710_sign_extend_24(raw1);
  *out2 = hx710_sign_extend_24(raw2);

  err = ESP_OK;

_cleanup:
  xSemaphoreGive(s_hx710_mutex);
  return err;
}
