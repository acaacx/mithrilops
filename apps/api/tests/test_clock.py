import re

from secureflow_api.clock import now_iso


def test_now_iso_shape():
    value = now_iso()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value)
