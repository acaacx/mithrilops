async def test_health(client):
    res = await client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "mode": "mock"}


async def test_applications_list_and_contract(client):
    res = await client.get("/api/applications")
    assert res.status_code == 200
    apps = res.json()
    assert len(apps) > 0
    # JSON contract stays camelCase for the SPA
    first = apps[0]
    assert "ownerUserId" in first
    assert "openVulnerabilities" in first
    assert "owner_user_id" not in first


async def test_application_by_id_and_404(client):
    apps = (await client.get("/api/applications")).json()
    found = await client.get(f"/api/applications/{apps[0]['id']}")
    assert found.status_code == 200
    assert found.json()["id"] == apps[0]["id"]
    missing = await client.get("/api/applications/nope")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "application_not_found"


async def test_runs_filters(client):
    all_runs = (await client.get("/api/runs")).json()
    assert len(all_runs) > 0
    failed = (await client.get("/api/runs", params={"status": "failed"})).json()
    assert all(r["status"] == "failed" for r in failed)
    prod = (await client.get("/api/runs", params={"environment": "production"})).json()
    assert all(r["environment"] == "production" for r in prod)
    app_id = all_runs[0]["applicationId"]
    scoped = (await client.get("/api/runs", params={"applicationId": app_id})).json()
    assert len(scoped) > 0
    assert all(r["applicationId"] == app_id for r in scoped)


async def test_runs_invalid_status_rejected(client):
    res = await client.get("/api/runs", params={"status": "exploded"})
    assert res.status_code == 422


async def test_run_by_id_and_404(client):
    run_id = (await client.get("/api/runs")).json()[0]["id"]
    assert (await client.get(f"/api/runs/{run_id}")).json()["id"] == run_id
    assert (await client.get("/api/runs/run-none")).status_code == 404


async def test_stage_logs_deterministic(client):
    run = (await client.get("/api/runs")).json()[0]
    started = next(s for s in run["stages"] if s.get("startedAt"))
    url = f"/api/runs/{run['id']}/stages/{started['definitionId']}/logs"
    first = (await client.get(url)).json()
    assert len(first) >= 3
    assert first[0]["message"].startswith(f"Starting '{started['name']}'")
    assert first == (await client.get(url)).json()
    # unknown stage yields empty list, unknown run 404
    assert (await client.get(f"/api/runs/{run['id']}/stages/none/logs")).json() == []
    assert (await client.get("/api/runs/none/stages/none/logs")).status_code == 404


async def test_stage_logs_blocked_stage_no_namerefror(client):
    """Regression: logs for blocked/failed stages must not NameError on run.id."""
    runs = (await client.get("/api/runs")).json()
    # Find a run with a blocked or failed stage that has been started
    blocked_run = None
    blocked_stage = None
    for run in runs:
        for stage in run["stages"]:
            if stage["status"] in ("blocked", "failed") and stage.get("startedAt"):
                blocked_run = run
                blocked_stage = stage
                break
        if blocked_stage:
            break

    if blocked_run and blocked_stage:
        # Should not raise NameError; logs should include the error message with run.id
        url = f"/api/runs/{blocked_run['id']}/stages/{blocked_stage['definitionId']}/logs"
        logs = (await client.get(url)).json()
        assert len(logs) > 0
        # Find the error message that includes the evidence bundle reference
        evidence_msgs = [
            m for m in logs
            if "Evidence bundle" in m.get("message", "")
            and blocked_run["id"] in m.get("message", "")
        ]
        assert len(evidence_msgs) > 0, "Should have evidence bundle message with run.id"


async def test_collection_endpoints_nonempty(client):
    for path in ("/api/findings", "/api/deployments", "/api/plans", "/api/frameworks", "/api/audit"):
        res = await client.get(path)
        assert res.status_code == 200, path
        assert len(res.json()) > 0, path


async def test_security_headers(client):
    res = await client.get("/health")
    assert res.headers["Content-Security-Policy"] == "default-src 'self'; frame-ancestors 'none'"
    assert res.headers["X-Content-Type-Options"] == "nosniff"


async def test_finding_by_id_and_404(client):
    findings = (await client.get("/api/findings")).json()
    found = await client.get(f"/api/findings/{findings[0]['id']}")
    assert found.status_code == 200
    assert found.json()["id"] == findings[0]["id"]
    assert (await client.get("/api/findings/nope")).status_code == 404


async def test_plan_by_id_and_404(client):
    plans = (await client.get("/api/plans")).json()
    assert (await client.get(f"/api/plans/{plans[0]['id']}")).json()["id"] == plans[0]["id"]
    assert (await client.get("/api/plans/nope")).status_code == 404


async def test_framework_by_id_and_404(client):
    fw = (await client.get("/api/frameworks")).json()[0]
    assert (await client.get(f"/api/frameworks/{fw['id']}")).json()["id"] == fw["id"]
    assert (await client.get("/api/frameworks/nope")).status_code == 404


async def test_integrations_list(client):
    integrations = (await client.get("/api/integrations")).json()
    assert len(integrations) > 0
    assert "lastSyncAt" in integrations[0] or "description" in integrations[0]


async def test_architecture_diagram_and_404(client):
    apps = (await client.get("/api/applications")).json()
    diagram = await client.get(f"/api/architecture/{apps[0]['id']}")
    assert diagram.status_code == 200
    body = diagram.json()
    assert body["applicationId"] == apps[0]["id"]
    assert len(body["nodes"]) > 0
    assert (await client.get("/api/architecture/nope")).status_code == 404
