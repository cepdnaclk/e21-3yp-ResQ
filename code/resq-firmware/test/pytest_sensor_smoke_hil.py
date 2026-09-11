import os

import pytest
from pytest_embedded import Dut


pytestmark = [
    pytest.mark.esp32c3,
    pytest.mark.sensor_hil,
]


@pytest.mark.skipif(
    os.environ.get("RESQ_RUN_SENSOR_HIL") != "1",
    reason="Set RESQ_RUN_SENSOR_HIL=1 and connect real ResQ sensors to run HIL smoke checks.",
)
def test_pressure_and_hall_sensor_smoke_hil(dut: Dut) -> None:
    """Optional real-board smoke path for pressure and Hall sensor diagnostics.

    This test intentionally does not run in the normal Unity suite. It expects
    firmware with sensor diagnostic/calibration serial logging enabled and a
    human operator to press and release the CPR manikin when prompted by the
    firmware logs.
    """
    dut.expect("ResQ", timeout=30)
    dut.expect("pressure", timeout=60)
    dut.expect("hall", timeout=60)
    dut.expect("pressure OK", timeout=180)
    dut.expect("hall OK", timeout=180)
