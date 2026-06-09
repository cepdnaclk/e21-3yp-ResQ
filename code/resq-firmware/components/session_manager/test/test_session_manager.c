#include "session_manager.h"
#include "unity.h"

TEST_CASE("Session manager lifecycle is repeatable", "[session]")
{
    session_state_t state;
    TEST_ASSERT_EQUAL(ESP_OK, session_manager_init());
    TEST_ASSERT_FALSE(session_manager_is_active());
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, session_manager_start(NULL, "adult"));
    TEST_ASSERT_EQUAL(ESP_OK, session_manager_start("s-1", "adult"));
    TEST_ASSERT_TRUE(session_manager_is_active());
    TEST_ASSERT_EQUAL_STRING("s-1", session_manager_get_session_id());
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE,
                      session_manager_start("s-2", "adult"));
    TEST_ASSERT_EQUAL(ESP_OK, session_manager_get_state(&state));
    TEST_ASSERT_TRUE(state.active);
    TEST_ASSERT_EQUAL_STRING("adult", state.profile_id);
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, session_manager_stop("wrong"));
    TEST_ASSERT_EQUAL(ESP_OK, session_manager_stop("s-1"));
    TEST_ASSERT_FALSE(session_manager_is_active());
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_STATE, session_manager_stop("s-1"));

    TEST_ASSERT_EQUAL(ESP_OK, session_manager_start("s-2", NULL));
    TEST_ASSERT_EQUAL(ESP_OK, session_manager_stop(NULL));
}

TEST_CASE("Session manager records terminal interruption", "[session]")
{
    session_state_t state;
    TEST_ASSERT_EQUAL(ESP_OK, session_manager_init());
    TEST_ASSERT_EQUAL(ESP_OK, session_manager_mark_interrupted("idle"));
    TEST_ASSERT_EQUAL(ESP_OK, session_manager_start("s-interrupt", "adult"));
    TEST_ASSERT_EQUAL(ESP_OK,
                      session_manager_mark_interrupted("connectivity_timeout"));
    TEST_ASSERT_EQUAL(ESP_OK, session_manager_get_state(&state));
    TEST_ASSERT_FALSE(state.active);
    TEST_ASSERT_TRUE(state.interrupted);
    TEST_ASSERT_EQUAL_STRING("s-interrupt", state.session_id);
}

TEST_CASE("Session manager validates output pointers", "[session]")
{
    TEST_ASSERT_EQUAL(ESP_OK, session_manager_init());
    TEST_ASSERT_EQUAL(ESP_ERR_INVALID_ARG, session_manager_get_state(NULL));
}
