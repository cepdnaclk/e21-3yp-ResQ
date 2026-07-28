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

    # Parse the live menu without pytest-embedded's automatic post-parse hard
    # reset. On this ESP32-C3/USB serial setup that reset callback can leave the
    # device at the menu while the helper waits for a second boot prompt.
    menu = dut._parse_test_menu()
    if test_name:
        assert any(case.name == test_name for case in menu), (
            f"No Unity test matched RESQ_UNITY_NAME={test_name!r}"
        )
    if test_group:
        assert any(test_group in case.groups for case in menu), (
            f"No Unity test matched RESQ_UNITY_GROUP={test_group!r}"
        )

    selected = [
        case
        for case in menu
        if (test_name and case.name == test_name)
        or (test_group and test_group in case.groups)
    ]
    assert selected, "Set RESQ_UNITY_NAME or RESQ_UNITY_GROUP"

    for case in selected:
        # pytest-embedded 2.8.1 appends LF to writes, while this Unity console
        # requires CR to terminate a numeric menu selection.
        dut.confirm_write(
            f"{case.index}\r",
            expect_str=f"Running {case.name}...",
            timeout=5,
        )
        result = dut.expect(
            re.compile(rb"(\d+) Tests (\d+) Failures (\d+) Ignored\s+(OK|FAIL)"),
            timeout=300,
        )
        total, failures, ignored, status = result.groups()
        assert int(total) == 1
        assert int(failures) == 0
        assert int(ignored) == 0
        assert status == b"OK"
