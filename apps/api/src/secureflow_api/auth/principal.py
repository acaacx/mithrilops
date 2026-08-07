"""Authenticated caller identity. DEMO_PRINCIPAL is what disabled-mode
requests act as; its name "You" keeps demo output identical to pre-auth."""

from dataclasses import dataclass

from fastapi import HTTPException

from ..models import Role
from .rbac import Permission, permissions_for


@dataclass(frozen=True)
class Principal:
    sub: str
    name: str
    roles: tuple[Role, ...]

    @property
    def permissions(self) -> frozenset[Permission]:
        return permissions_for(self.roles)

    def require(self, permission: Permission) -> None:
        if permission not in self.permissions:
            raise HTTPException(status_code=403, detail="forbidden")


DEMO_PRINCIPAL = Principal(sub="demo-user", name="You", roles=("administrator",))
