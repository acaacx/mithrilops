import pytest

from secureflow_api import state, simulator


@pytest.fixture(autouse=True)
def fresh_state():
    state.reset_state()
    simulator.reset()
    yield
    state.reset_state()
    simulator.reset()
