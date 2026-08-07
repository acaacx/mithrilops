import pytest
from fastapi import HTTPException

from secureflow_api.auth.principal import DEMO_PRINCIPAL, Principal


def test_permissions_derived_from_roles():
    p = Principal(sub="u1", name="Dev", roles=("developer",))
    assert "pipeline.trigger" in p.permissions
    assert "deployment.approve" not in p.permissions


def test_require_passes_when_granted():
    Principal(sub="u1", name="Dev", roles=("developer",)).require("pipeline.trigger")


def test_require_raises_403_when_missing():
    p = Principal(sub="u1", name="Dev", roles=("developer",))
    with pytest.raises(HTTPException) as exc:
        p.require("deployment.approve")
    assert exc.value.status_code == 403
    assert exc.value.detail == "forbidden"


def test_no_roles_means_no_permissions():
    assert Principal(sub="u1", name="X", roles=()).permissions == frozenset()


def test_demo_principal_is_administrator_named_you():
    assert DEMO_PRINCIPAL.name == "You"
    assert "settings.manage" in DEMO_PRINCIPAL.permissions
