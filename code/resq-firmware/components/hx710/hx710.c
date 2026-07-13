#include "hx710.h"

#include "esp_rom_sys.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_log.h"

/* Timeout is expressed in wall-clock milliseconds, independent of RTOS tick
 * frequency. */
#define HX710_READY_TIMEOUT_MS 150

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
  const TickType_t max_wait_ticks = pdMS_TO_TICKS(HX710_READY_TIMEOUT_MS);

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
static StaticSemaphore_t s_hx710_mutex_storage;
static portMUX_TYPE s_hx710_init_lock = portMUX_INITIALIZER_UNLOCKED;

static void hx710_ensure_mutex(void)
{
  taskENTER_CRITICAL(&s_hx710_init_lock);
  if (s_hx710_mutex == NULL)
    s_hx710_mutex = xSemaphoreCreateMutexStatic(&s_hx710_mutex_storage);
  taskEXIT_CRITICAL(&s_hx710_init_lock);
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
  uint8_t valid_mask = 0;
  esp_err_t err = hx710_read_3_shared_sck_valid(
      sck_pin, dout0_pin, dout1_pin, dout2_pin, out0, out1, out2,
      &valid_mask);
  if (err != ESP_OK) return err;
  return valid_mask == HX710_VALID_CHANNEL_ALL ? ESP_OK
                                               : ESP_ERR_INVALID_RESPONSE;
}

esp_err_t hx710_read_3_shared_sck_valid(gpio_num_t sck_pin,
                                        gpio_num_t dout0_pin,
                                        gpio_num_t dout1_pin,
                                        gpio_num_t dout2_pin,
                                        int32_t *out0,
                                        int32_t *out1,
                                        int32_t *out2,
                                        uint8_t *out_valid_mask)
{
  if (out0 == NULL || out1 == NULL || out2 == NULL ||
      out_valid_mask == NULL) {
    return ESP_ERR_INVALID_ARG;
  }
  *out0 = HX710_ERROR_TIMEOUT;
  *out1 = HX710_ERROR_TIMEOUT;
  *out2 = HX710_ERROR_TIMEOUT;
  *out_valid_mask = 0;

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

  /* Diagnostic: log DOUT pin levels before waiting for ready */
  ESP_LOGD(TAG, "DOUT initial levels before ready: dout0(GPIO%d)=%d dout1(GPIO%d)=%d dout2(GPIO%d)=%d",
           dout0_pin, gpio_get_level(dout0_pin),
           dout1_pin, gpio_get_level(dout1_pin),
           dout2_pin, gpio_get_level(dout2_pin));

  /* Wait for at least one channel. A stalled DOUT remains invalid but cannot
   * prevent healthy channels from being clocked and sampled. */
  TickType_t started = xTaskGetTickCount();
  const TickType_t max_wait_ticks = pdMS_TO_TICKS(HX710_READY_TIMEOUT_MS);
  uint8_t ready_mask = 0;
  while (ready_mask == 0) {
    if (gpio_get_level(dout0_pin) == 0) ready_mask |= HX710_VALID_CHANNEL_0;
    if (gpio_get_level(dout1_pin) == 0) ready_mask |= HX710_VALID_CHANNEL_1;
    if (gpio_get_level(dout2_pin) == 0) ready_mask |= HX710_VALID_CHANNEL_2;
    if (ready_mask != 0) break;
    vTaskDelay(1);
    if ((xTaskGetTickCount() - started) >= max_wait_ticks) {
      ESP_LOGW(TAG, "Timeout waiting for any HX710 sensor ready");
      err = ESP_ERR_TIMEOUT;
      goto _cleanup;
    }
  }

  /* Include channels that became ready during the final scheduler tick. */
  if (gpio_get_level(dout0_pin) == 0) ready_mask |= HX710_VALID_CHANNEL_0;
  if (gpio_get_level(dout1_pin) == 0) ready_mask |= HX710_VALID_CHANNEL_1;
  if (gpio_get_level(dout2_pin) == 0) ready_mask |= HX710_VALID_CHANNEL_2;

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

  if (ready_mask & HX710_VALID_CHANNEL_0) *out0 = hx710_sign_extend_24(raw0);
  if (ready_mask & HX710_VALID_CHANNEL_1) *out1 = hx710_sign_extend_24(raw1);
  if (ready_mask & HX710_VALID_CHANNEL_2) *out2 = hx710_sign_extend_24(raw2);
  *out_valid_mask = ready_mask;

  /* Debug builds: show decimal and hex representations of the raw sensor values */
  ESP_LOGD(TAG,
           "hx710 read results: p0=%ld hex=0x%06X p1=%ld hex=0x%06X p2=%ld hex=0x%06X",
           (long)*out0, (unsigned int)(raw0 & 0xFFFFFF),
           (long)*out1, (unsigned int)(raw1 & 0xFFFFFF),
           (long)*out2, (unsigned int)(raw2 & 0xFFFFFF));

  err = ESP_OK;

_cleanup:
  xSemaphoreGive(s_hx710_mutex);
  return err;
}
