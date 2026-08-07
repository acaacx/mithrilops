"""Server-side RBAC matrix. Mirrors packages/types/src/role-permissions.json;
test_auth_rbac.py asserts parity so the two cannot drift silently."""

from collections.abc import Iterable
from typing import Literal

from ..models import Role

Permission = Literal[
    "deployment.approve",
    "deployment.reject",
    "deployment.request-changes",
    "deployment.promote",
    "deployment.rollback",
    "pipeline.retry-stage",
    "pipeline.trigger",
    "risk.accept",
    "finding.update-status",
    "remediation.create",
    "evidence.download",
    "compliance.review",
    "integration.manage",
    "settings.manage",
    "audit.view",
]

_BASE: tuple[Permission, ...] = ("audit.view", "evidence.download")

ROLE_PERMISSIONS: dict[Role, tuple[Permission, ...]] = {
    "developer": (*_BASE, "pipeline.trigger", "pipeline.retry-stage", "remediation.create"),
    "devsecops-engineer": (
        *_BASE,
        "pipeline.trigger",
        "pipeline.retry-stage",
        "finding.update-status",
        "remediation.create",
        "deployment.request-changes",
    ),
    "security-engineer": (
        *_BASE,
        "finding.update-status",
        "risk.accept",
        "remediation.create",
        "deployment.request-changes",
        "deployment.reject",
    ),
    "platform-engineer": (
        *_BASE,
        "pipeline.trigger",
        "pipeline.retry-stage",
        "deployment.rollback",
        "integration.manage",
    ),
    "application-owner": (
        *_BASE,
        "deployment.request-changes",
        "remediation.create",
        "risk.accept",
    ),
    "compliance-reviewer": (*_BASE, "compliance.review"),
    "release-approver": (
        *_BASE,
        "deployment.approve",
        "deployment.reject",
        "deployment.request-changes",
        "deployment.promote",
        "deployment.rollback",
    ),
    "administrator": (
        *_BASE,
        "deployment.approve",
        "deployment.reject",
        "deployment.request-changes",
        "deployment.promote",
        "deployment.rollback",
        "pipeline.retry-stage",
        "pipeline.trigger",
        "risk.accept",
        "finding.update-status",
        "remediation.create",
        "compliance.review",
        "integration.manage",
        "settings.manage",
    ),
}


def permissions_for(roles: Iterable[Role]) -> frozenset[Permission]:
    out: set[Permission] = set()
    for role in roles:
        out.update(ROLE_PERMISSIONS[role])
    return frozenset(out)
