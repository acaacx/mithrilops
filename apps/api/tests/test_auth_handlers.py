async def _pick_waiting_run(client, token):
    runs = (
        await client.get("/api/runs", headers={"Authorization": f"Bearer {token}"})
    ).json()
    return next(r for r in runs if r["status"] == "waiting-approval")


def _approval_body(decision):
    return {"decision": decision, "comment": "test", "environment": "production"}


async def test_approve_needs_deployment_approve(auth_enabled, make_token, client):
    admin = make_token()
    run = await _pick_waiting_run(client, admin)
    denied = await client.post(
        f"/api/runs/{run['id']}/approval", json=_approval_body("approved"),
        headers={"Authorization": f"Bearer {make_token(roles=['developer'])}"},
    )
    assert denied.status_code == 403


async def test_reject_allowed_for_security_engineer(auth_enabled, make_token, client):
    admin = make_token()
    run = await _pick_waiting_run(client, admin)
    response = await client.post(
        f"/api/runs/{run['id']}/approval", json=_approval_body("rejected"),
        headers={"Authorization": f"Bearer {make_token(roles=['security-engineer'])}"},
    )
    assert response.status_code == 204


async def test_approve_records_principal_name(auth_enabled, make_token, client):
    approver = make_token(roles=["release-approver"])
    run = await _pick_waiting_run(client, approver)
    response = await client.post(
        f"/api/runs/{run['id']}/approval", json=_approval_body("approved"),
        headers={"Authorization": f"Bearer {approver}"},
    )
    assert response.status_code == 204
    approvals = (
        await client.get(
            f"/api/runs/{run['id']}/approvals",
            headers={"Authorization": f"Bearer {approver}"},
        )
    ).json()
    decided = [a for a in approvals if a["decision"] == "approved"]
    assert decided and decided[0]["decidedBy"] == "Test User"


async def test_changes_requested_permission(auth_enabled, make_token, client):
    admin = make_token()
    run = await _pick_waiting_run(client, admin)
    denied = await client.post(
        f"/api/runs/{run['id']}/approval", json=_approval_body("changes-requested"),
        headers={"Authorization": f"Bearer {make_token(roles=['compliance-reviewer'])}"},
    )
    assert denied.status_code == 403


async def test_accepted_risk_needs_risk_accept(auth_enabled, make_token, client):
    admin = make_token()
    findings = (
        await client.get("/api/findings", headers={"Authorization": f"Bearer {admin}"})
    ).json()
    finding_id = findings[0]["id"]
    # devsecops-engineer HAS finding.update-status but NOT risk.accept
    devsecops = make_token(roles=["devsecops-engineer"])
    denied = await client.patch(
        f"/api/findings/{finding_id}/status",
        json={"status": "accepted-risk", "reason": "test"},
        headers={"Authorization": f"Bearer {devsecops}"},
    )
    assert denied.status_code == 403
    allowed_other_status = await client.patch(
        f"/api/findings/{finding_id}/status",
        json={"status": "resolved", "reason": "test"},
        headers={"Authorization": f"Bearer {devsecops}"},
    )
    assert allowed_other_status.status_code == 204
    security = make_token(roles=["security-engineer"])
    allowed = await client.patch(
        f"/api/findings/{finding_id}/status",
        json={"status": "accepted-risk", "reason": "test"},
        headers={"Authorization": f"Bearer {security}"},
    )
    assert allowed.status_code == 204
