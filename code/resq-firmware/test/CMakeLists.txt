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
    "session_active_manager"
    "cpr_metrics"
    "pressure_quality_filter"
    "sensor_conversion"
    "sensor_owner"
    "telemetry_publisher"
    "system_button_manager"
    "io_mode_manager"
    "calibration_fingerprint"
    "provisioning_manager"
    "backend_register_client"
    "hx710"
    CACHE STRING "ResQ components under test"
    FORCE
)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
idf_build_set_property(MINIMAL_BUILD ON)
project(resq_firmware_unity)
