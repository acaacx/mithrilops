from fastapi.testclient import TestClient

from secureflow_api.main import app

client = TestClient(app)


def _first_run_id() -> str:
    return client.get("/api/runs").json()[0]["id"]


def test_retry_stage_marks_stage_running_and_records_audit():
    run = client.get("/api/runs").json()[0]
    stage = run["stages"][0]
    res = client.post(f"/api/runs/{run['id']}/stages/{stage['id']}/retry")
    assert res.status_code == 204
    updated = client.get(f"/api/runs/{run['id']}").json()
    assert updated["status"] == "running"
    assert updated["stages"][0]["status"] == "running"
    assert updated["stages"][0]["finishedAt"] is None
    newest = client.get("/api/audit").json()[0]
    assert newest["action"] == "stage.retried"
    assert client.post("/api/runs/run-none/stages/x/retry").status_code == 404


def test_approval_approved_resumes_run():
    run_id = _first_run_id()
    res = client.post(
        f"/api/runs/{run_id}/approval",
        json={"decision": "approved", "comment": "smoke approval", "environment": "production"},
    )
    assert res.status_code == 204
    assert client.get(f"/api/runs/{run_id}").json()["approvalStatus"] == "approved"


def test_approval_rejected_cancels_run():
    run_id = _first_run_id()
    client.post(
        f"/api/runs/{run_id}/approval",
        json={"decision": "rejected", "comment": "not today", "environment": "production"},
    )
    run = client.get(f"/api/runs/{run_id}").json()
    assert run["approvalStatus"] == "rejected"
    assert run["status"] == "cancelled"


def test_update_finding_status_with_reason_appends_suppression():
    finding = client.get("/api/findings").json()[0]
    res = client.patch(
        f"/api/findings/{finding['id']}/status",
        json={"status": "accepted-risk", "reason": "documented business exception"},
    )
    assert res.status_code == 204
    updated = client.get(f"/api/findings/{finding['id']}").json()
    assert updated["status"] == "accepted-risk"
    assert updated["suppressionHistory"][-1]["reason"] == "documented business exception"
    assert client.get("/api/audit").json()[0]["action"] == "finding.status-changed"
    assert client.patch("/api/findings/nope/status", json={"status": "open"}).status_code == 404


def test_sync_marks_deployments_synced():
    app_id = client.get("/api/applications").json()[0]["id"]
    assert client.post(f"/api/applications/{app_id}/sync").status_code == 204
    deps = [d for d in client.get("/api/deployments").json() if d["applicationId"] == app_id]
    assert all(d["argoSyncStatus"] == "synced" for d in deps)
    assert client.post("/api/applications/nope/sync").status_code == 404


def test_promote_moves_version_forward():
    app_id = client.get("/api/applications").json()[0]["id"]
    deps = [d for d in client.get("/api/deployments").json() if d["applicationId"] == app_id]
    envs = {d["environment"] for d in deps}
    assert {"staging", "production"} <= envs, "fixture assumption: staging+production exist"
    staging = next(d for d in deps if d["environment"] == "staging")
    res = client.post(f"/api/applications/{app_id}/promote", json={"toEnvironment": "production"})
    assert res.status_code == 204
    prod = next(
        d
        for d in client.get("/api/deployments").json()
        if d["applicationId"] == app_id and d["environment"] == "production"
    )
    assert prod["version"] == staging["version"]
    assert prod["status"] == "progressing"
    assert client.get("/api/audit").json()[0]["action"] == "deployment.promoted"


def test_rollback_restores_revision():
    app_id = client.get("/api/applications").json()[0]["id"]
    res = client.post(f"/api/applications/{app_id}/rollback", json={"revision": "1.0.0-test"})
    assert res.status_code == 204
    prod = next(
        d
        for d in client.get("/api/deployments").json()
        if d["applicationId"] == app_id and d["environment"] == "production"
    )
    assert prod["version"] == "1.0.0-test"
    assert prod["status"] == "rolled-back"
    assert client.get("/api/audit").json()[0]["action"] == "deployment.rolled-back"


def test_post_audit_creates_event():
    res = client.post(
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
    assert client.get("/api/audit").json()[0]["action"] == "test.recorded"
