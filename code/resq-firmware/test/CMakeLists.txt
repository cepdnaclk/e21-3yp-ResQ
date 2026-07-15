cmake_minimum_required(VERSION 3.22)

set(EXTRA_COMPONENT_DIRS "../components")
set(TEST_COMPONENTS
    "firmware_state_machine"
    "calibration_manager"
    "config"
    "error_manager"
    "mqtt_manager"
    "runtime_helpers"
    "runtime_identity"
    "session_manager"
    "cpr_metrics"
    "sensor_conversion"
    "sensor_owner"
    "telemetry_publisher"
    "system_button_manager"
    "io_mode_manager"
    "calibration_fingerprint"
    CACHE STRING "ResQ components under test"
    FORCE
)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
idf_build_set_property(MINIMAL_BUILD ON)
project(resq_firmware_unity)
