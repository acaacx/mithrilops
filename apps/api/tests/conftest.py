import pytest

from secureflow_api import state


@pytest.fixture(autouse=True)
def fresh_state():
    state.reset_state()
    yield
    state.reset_state()
