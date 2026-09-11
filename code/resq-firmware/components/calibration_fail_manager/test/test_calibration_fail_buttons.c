#include "calibration_fail_manager.h"

#include "unity.h"

static resq_state_t state_for(system_button_id_t button,
                              system_button_press_type_t press)
{
    system_button_event_t event = {
        .button_id = button,
        .press_type = press,
    };
    return calibration_fail_manager_state_for_button(&event);
}

TEST_CASE("CALIBRATION_FAIL button 1 short retries calibration",
          "[calibration][fsm][buttons]")
{
    TEST_ASSERT_EQUAL(
        RESQ_STATE_CALIBRATING,
        state_for(SYSTEM_BUTTON_ID_1, SYSTEM_BUTTON_PRESS_SHORT));
}

TEST_CASE("CALIBRATION_FAIL button 2 short returns paired idle",
          "[calibration][fsm][buttons]")
{
    TEST_ASSERT_EQUAL(
        RESQ_STATE_PAIRED_IDLE,
        state_for(SYSTEM_BUTTON_ID_2, SYSTEM_BUTTON_PRESS_SHORT));
}

TEST_CASE("CALIBRATION_FAIL button 1 long turns off",
          "[calibration][fsm][buttons]")
{
    TEST_ASSERT_EQUAL(
        RESQ_STATE_TURN_OFF,
        state_for(SYSTEM_BUTTON_ID_1, SYSTEM_BUTTON_PRESS_LONG));
}

TEST_CASE("CALIBRATION_FAIL button 2 long resets",
          "[calibration][fsm][buttons]")
{
    TEST_ASSERT_EQUAL(
        RESQ_STATE_RESETTING,
        state_for(SYSTEM_BUTTON_ID_2, SYSTEM_BUTTON_PRESS_LONG));
}

TEST_CASE("CALIBRATION_FAIL ignores unrelated button events",
          "[calibration][fsm][buttons]")
{
    TEST_ASSERT_EQUAL(RESQ_STATE_CALIBRATION_FAIL,
                      calibration_fail_manager_state_for_button(NULL));
    TEST_ASSERT_EQUAL(
        RESQ_STATE_CALIBRATION_FAIL,
        state_for(SYSTEM_BUTTON_ID_1, SYSTEM_BUTTON_PRESS_NONE));
}
