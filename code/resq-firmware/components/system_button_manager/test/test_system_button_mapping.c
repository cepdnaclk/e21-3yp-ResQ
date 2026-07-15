#include "system_button_manager.h"

#include "unity.h"

static system_button_action_t map(system_button_id_t button,
                                  system_button_press_type_t press)
{
    system_button_event_t event = {
        .button_id = button,
        .press_type = press,
    };
    return system_button_manager_action_for_event(&event);
}

TEST_CASE("button 1 short selects USB mode", "[buttons][io_mode]")
{
    TEST_ASSERT_EQUAL(SYSTEM_BUTTON_ACTION_REQUEST_USB_MODE,
                      map(SYSTEM_BUTTON_ID_1, SYSTEM_BUTTON_PRESS_SHORT));
}

TEST_CASE("button 2 short selects SENSOR mode", "[buttons][io_mode]")
{
    TEST_ASSERT_EQUAL(SYSTEM_BUTTON_ACTION_REQUEST_SENSOR_MODE,
                      map(SYSTEM_BUTTON_ID_2, SYSTEM_BUTTON_PRESS_SHORT));
}

TEST_CASE("button 1 long preserves TURN_OFF", "[buttons][io_mode]")
{
    TEST_ASSERT_EQUAL(SYSTEM_BUTTON_ACTION_TURN_OFF,
                      map(SYSTEM_BUTTON_ID_1, SYSTEM_BUTTON_PRESS_LONG));
}

TEST_CASE("button 2 long preserves FACTORY_RESET", "[buttons][io_mode]")
{
    TEST_ASSERT_EQUAL(SYSTEM_BUTTON_ACTION_FACTORY_RESET,
                      map(SYSTEM_BUTTON_ID_2, SYSTEM_BUTTON_PRESS_LONG));
}
