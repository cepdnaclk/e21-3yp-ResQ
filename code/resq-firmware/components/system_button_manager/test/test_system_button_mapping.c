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

TEST_CASE("button 1 short has no global mode action", "[buttons][io_mode]")
{
    TEST_ASSERT_EQUAL(SYSTEM_BUTTON_ACTION_NONE,
                      map(SYSTEM_BUTTON_ID_1, SYSTEM_BUTTON_PRESS_SHORT));
}

TEST_CASE("button 2 short has no global mode action", "[buttons][io_mode]")
{
    TEST_ASSERT_EQUAL(SYSTEM_BUTTON_ACTION_NONE,
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

TEST_CASE("press duration below threshold remains short", "[buttons]")
{
    TEST_ASSERT_EQUAL(SYSTEM_BUTTON_PRESS_SHORT,
                      system_button_manager_classify_duration(2999));
}

TEST_CASE("press duration at threshold remains long", "[buttons]")
{
    TEST_ASSERT_EQUAL(SYSTEM_BUTTON_PRESS_LONG,
                      system_button_manager_classify_duration(3000));
}
