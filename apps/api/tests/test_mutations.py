async def _first_run_id(client) -> str:
    return (await client.get("/api/runs")).json()[0]["id"]


async def test_retry_stage_marks_stage_running_and_records_audit(client):
    run = (await client.get("/api/runs")).json()[0]
    stage = run["stages"][0]
    res = await client.post(f"/api/runs/{run['id']}/stages/{stage['id']}/retry")
    assert res.status_code == 204
    updated = (await client.get(f"/api/runs/{run['id']}")).json()
    assert updated["status"] == "running"
    assert updated["stages"][0]["status"] == "running"
    assert updated["stages"][0]["finishedAt"] is None
    newest = (await client.get("/api/audit")).json()[0]
    assert newest["action"] == "stage.retried"
    assert (await client.post("/api/runs/run-none/stages/x/retry")).status_code == 404


async def test_approval_approved_resumes_run(client):
    run_id = await _first_run_id(client)
    res = await client.post(
        f"/api/runs/{run_id}/approval",
        json={"decision": "approved", "comment": "smoke approval", "environment": "production"},
    )
    assert res.status_code == 204
    assert (await client.get(f"/api/runs/{run_id}")).json()["approvalStatus"] == "approved"


async def test_approval_rejected_cancels_run(client):
    run_id = await _first_run_id(client)
    await client.post(
        f"/api/runs/{run_id}/approval",
        json={"decision": "rejected", "comment": "not today", "environment": "production"},
    )
    run = (await client.get(f"/api/runs/{run_id}")).json()
    assert run["approvalStatus"] == "rejected"
    assert run["status"] == "cancelled"


async def test_update_finding_status_with_reason_appends_suppression(client):
    finding = (await client.get("/api/findings")).json()[0]
    res = await client.patch(
        f"/api/findings/{finding['id']}/status",
        json={"status": "accepted-risk", "reason": "documented business exception"},
    )
    assert res.status_code == 204
    updated = (await client.get(f"/api/findings/{finding['id']}")).json()
    assert updated["status"] == "accepted-risk"
    assert updated["suppressionHistory"][-1]["reason"] == "documented business exception"
    assert (await client.get("/api/audit")).json()[0]["action"] == "finding.status-changed"
    res = await client.patch("/api/findings/nope/status", json={"status": "open"})
    assert res.status_code == 404


async def test_sync_marks_deployments_synced(client):
    app_id = (await client.get("/api/applications")).json()[0]["id"]
    assert (await client.post(f"/api/applications/{app_id}/sync")).status_code == 204
    deps = [d for d in (await client.get("/api/deployments")).json() if d["applicationId"] == app_id]
    assert all(d["argoSyncStatus"] == "synced" for d in deps)
    assert (await client.post("/api/applications/nope/sync")).status_code == 404


async def test_promote_moves_version_forward(client):
    app_id = (await client.get("/api/applications")).json()[0]["id"]
    deps = [d for d in (await client.get("/api/deployments")).json() if d["applicationId"] == app_id]
    envs = {d["environment"] for d in deps}
    assert {"staging", "production"} <= envs, "fixture assumption: staging+production exist"
    staging = next(d for d in deps if d["environment"] == "staging")
    res = await client.post(
        f"/api/applications/{app_id}/promote", json={"toEnvironment": "production"}
    )
    assert res.status_code == 204
    prod = next(
        d
        for d in (await client.get("/api/deployments")).json()
        if d["applicationId"] == app_id and d["environment"] == "production"
    )
    assert prod["version"] == staging["version"]
    assert prod["status"] == "progressing"
    assert (await client.get("/api/audit")).json()[0]["action"] == "deployment.promoted"


async def test_rollback_restores_revision(client):
    app_id = (await client.get("/api/applications")).json()[0]["id"]
    res = await client.post(
        f"/api/applications/{app_id}/rollback", json={"revision": "1.0.0-test"}
    )
    assert res.status_code == 204
    prod = next(
        d
        for d in (await client.get("/api/deployments")).json()
        if d["applicationId"] == app_id and d["environment"] == "production"
    )
    assert prod["version"] == "1.0.0-test"
    assert prod["status"] == "rolled-back"
    assert (await client.get("/api/audit")).json()[0]["action"] == "deployment.rolled-back"


async def test_post_audit_creates_event(client):
    res = await client.post(
        "/api/audit",
        json={
            "actor": "You",
            "actorRole": "security-engineer",
            "action": "test.recorded",
            "target": "smoke",
            "targetType": "Test",
            "outcome": "success",
            "detail": "posted from test",
        },
    )
    assert res.status_code == 201
    assert res.json()["id"].startswith("aud-")
    assert (await client.get("/api/audit")).json()[0]["action"] == "test.recorded"


async def test_list_approvals_returns_only_that_runs_approvals(client):
    res = await client.get("/api/runs/run-1482/approvals")
    assert res.status_code == 200
    approvals = res.json()
    assert approvals, "run-1482 is seeded with approvals"
    assert {a["runId"] for a in approvals} == {"run-1482"}
    assert {"id", "environment", "requiredRole", "decision"} <= approvals[0].keys()
    assert (await client.get("/api/runs/run-none/approvals")).status_code == 404


async def test_approval_decision_is_recorded_on_the_pending_approval(client):
    before = (await client.get("/api/runs/run-1482/approvals")).json()
    assert any(a["decision"] == "pending" for a in before)
    res = await client.post(
        "/api/runs/run-1482/approval",
        json={
            "decision": "approved",
            "comment": "recorded on the approval",
            "environment": "production",
        },
    )
    assert res.status_code == 204
    after = (await client.get("/api/runs/run-1482/approvals")).json()
    assert not any(a["decision"] == "pending" for a in after)
    decided = next(a for a in after if a["comment"] == "recorded on the approval")
    assert decided["decision"] == "approved"
    assert decided["decidedBy"] == "You"
    assert decided["decidedAt"]


async def test_post_audit_returns_sequenced_event(client, db_session):
    from sqlalchemy import text

    await db_session.execute(text("SELECT setval('audit_id_seq', 100)"))
    res = await client.post("/api/audit", json={
        "actor": "You", "actorRole": "devsecops-engineer", "action": "test.action",
        "target": "unit-test", "targetType": "Test", "outcome": "success",
        "detail": "contract check",
    })
    assert res.status_code == 201
    assert res.json()["id"] == "aud-101"
    newest = (await client.get("/api/audit")).json()[0]
    assert newest["id"] == "aud-101"
