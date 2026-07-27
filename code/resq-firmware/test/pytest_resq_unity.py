import os
import re

import pytest
from pytest_embedded import Dut


@pytest.mark.esp32c3
@pytest.mark.unity
def test_resq_firmware_unity(dut: Dut) -> None:
    """Run selected or all registered single-board Unity cases."""
    if os.getenv("RESQ_UNITY_NATIVE_ALL"):
        dut.expect_exact("Press ENTER to see the list of tests", timeout=30)
        dut.write("*")
        result = dut.expect(
            re.compile(
                rb"(\d+) Tests (\d+) Failures (\d+) Ignored\s+(OK|FAIL)"
            ),
            timeout=600,
        )
        total, failures, ignored, status = result.groups()
        assert int(total) > 0
        assert int(failures) == 0
        assert int(ignored) == 0
        assert status == b"OK"
        return

    test_name = os.getenv("RESQ_UNITY_NAME")
    test_group = os.getenv("RESQ_UNITY_GROUP")

    dut.run_all_single_board_cases(
        name=test_name or None,
        group=test_group or None,
        timeout=300,
    )
