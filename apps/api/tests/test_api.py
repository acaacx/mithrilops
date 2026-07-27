from fastapi.testclient import TestClient

from secureflow_api.main import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "mode": "mock"}


def test_applications_list_and_contract():
    res = client.get("/api/applications")
    assert res.status_code == 200
    apps = res.json()
    assert len(apps) > 0
    # JSON contract stays camelCase for the SPA
    first = apps[0]
    assert "ownerUserId" in first
    assert "openVulnerabilities" in first
    assert "owner_user_id" not in first


def test_application_by_id_and_404():
    apps = client.get("/api/applications").json()
    found = client.get(f"/api/applications/{apps[0]['id']}")
    assert found.status_code == 200
    assert found.json()["id"] == apps[0]["id"]
    missing = client.get("/api/applications/nope")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "application_not_found"


def test_runs_filters():
    all_runs = client.get("/api/runs").json()
    assert len(all_runs) > 0
    failed = client.get("/api/runs", params={"status": "failed"}).json()
    assert all(r["status"] == "failed" for r in failed)
    prod = client.get("/api/runs", params={"environment": "production"}).json()
    assert all(r["environment"] == "production" for r in prod)
    app_id = all_runs[0]["applicationId"]
    scoped = client.get("/api/runs", params={"applicationId": app_id}).json()
    assert len(scoped) > 0
    assert all(r["applicationId"] == app_id for r in scoped)


def test_runs_invalid_status_rejected():
    res = client.get("/api/runs", params={"status": "exploded"})
    assert res.status_code == 422


def test_run_by_id_and_404():
    run_id = client.get("/api/runs").json()[0]["id"]
    assert client.get(f"/api/runs/{run_id}").json()["id"] == run_id
    assert client.get("/api/runs/run-none").status_code == 404


def test_stage_logs_deterministic():
    run = client.get("/api/runs").json()[0]
    started = next(s for s in run["stages"] if s.get("startedAt"))
    url = f"/api/runs/{run['id']}/stages/{started['definitionId']}/logs"
    first = client.get(url).json()
    assert len(first) >= 3
    assert first[0]["message"].startswith(f"Starting '{started['name']}'")
    assert first == client.get(url).json()
    # unknown stage yields empty list, unknown run 404
    assert client.get(f"/api/runs/{run['id']}/stages/none/logs").json() == []
    assert client.get("/api/runs/none/stages/none/logs").status_code == 404


def test_collection_endpoints_nonempty():
    for path in ("/api/findings", "/api/deployments", "/api/plans", "/api/frameworks", "/api/audit"):
        res = client.get(path)
        assert res.status_code == 200, path
        assert len(res.json()) > 0, path


def test_security_headers():
    res = client.get("/health")
    assert res.headers["Content-Security-Policy"] == "default-src 'self'; frame-ancestors 'none'"
    assert res.headers["X-Content-Type-Options"] == "nosniff"


def test_finding_by_id_and_404():
    findings = client.get("/api/findings").json()
    found = client.get(f"/api/findings/{findings[0]['id']}")
    assert found.status_code == 200
    assert found.json()["id"] == findings[0]["id"]
    assert client.get("/api/findings/nope").status_code == 404


def test_plan_by_id_and_404():
    plans = client.get("/api/plans").json()
    assert client.get(f"/api/plans/{plans[0]['id']}").json()["id"] == plans[0]["id"]
    assert client.get("/api/plans/nope").status_code == 404


def test_framework_by_id_and_404():
    fw = client.get("/api/frameworks").json()[0]
    assert client.get(f"/api/frameworks/{fw['id']}").json()["id"] == fw["id"]
    assert client.get("/api/frameworks/nope").status_code == 404


def test_integrations_list():
    integrations = client.get("/api/integrations").json()
    assert len(integrations) > 0
    assert "lastSyncAt" in integrations[0] or "description" in integrations[0]


def test_architecture_diagram_and_404():
    apps = client.get("/api/applications").json()
    diagram = client.get(f"/api/architecture/{apps[0]['id']}")
    assert diagram.status_code == 200
    body = diagram.json()
    assert body["applicationId"] == apps[0]["id"]
    assert len(body["nodes"]) > 0
    assert client.get("/api/architecture/nope").status_code == 404
