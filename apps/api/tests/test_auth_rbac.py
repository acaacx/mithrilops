import json
from pathlib import Path

from typing import get_args

from secureflow_api.auth.rbac import ROLE_PERMISSIONS, permissions_for
from secureflow_api.models import Role

REPO_ROOT = Path(__file__).resolve().parents[3]
CANONICAL = REPO_ROOT / "packages" / "types" / "src" / "role-permissions.json"


def test_matches_canonical_json():
    canonical = json.loads(CANONICAL.read_text())
    assert {role: sorted(perms) for role, perms in canonical.items()} == {
        role: sorted(perms) for role, perms in ROLE_PERMISSIONS.items()
    }


def test_covers_every_role():
    assert set(ROLE_PERMISSIONS) == set(get_args(Role))


def test_permissions_for_unions_roles():
    combined = permissions_for(["developer", "compliance-reviewer"])
    assert "pipeline.trigger" in combined
    assert "compliance.review" in combined
    assert "deployment.approve" not in combined


def test_permissions_for_empty_roles_is_empty():
    assert permissions_for([]) == frozenset()
