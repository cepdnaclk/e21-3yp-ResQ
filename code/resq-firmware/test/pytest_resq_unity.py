import pytest
from pytest_embedded import Dut


@pytest.mark.esp32c3
@pytest.mark.unity
def test_resq_firmware_unity(dut: Dut) -> None:
    """Run every registered single-board Unity case and fail on any case."""
    dut.run_all_single_board_cases(timeout=300)
