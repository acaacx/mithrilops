from datetime import datetime, timedelta, timezone

from secureflow_api.db import repositories
from secureflow_api.simulator import SIMULATED_RUN_ID, tick


async def _run(session):
    return await repositories.runs.get(session, SIMULATED_RUN_ID)


async def test_tick_advances_the_running_stage(db_session):
    run = await _run(db_session)
    assert run.status == "running", "fixture assumption: run-0512 ships mid-flight"
    running_idx = next(i for i, s in enumerate(run.stages) if s.status == "running")
    await tick(db_session)
    run = await _run(db_session)  # re-read: tick writes through its own save
    assert run.stages[running_idx].status == "succeeded"
    assert run.stages[running_idx].finished_at is not None


async def test_run_completes_then_restarts_after_idle(db_session):
    for _ in range(60):
        await tick(db_session)
        run = await _run(db_session)
        if run.status == "succeeded":
            break
    assert run.status == "succeeded"
    assert run.security_gate == "passed"
    assert all(s.status != "pending" for s in run.stages)

    # Idle window not yet elapsed: tick must not restart the run.
    await tick(db_session)
    assert (await _run(db_session)).status == "succeeded"

    # Age finished_at past IDLE_SECONDS; the next tick restarts.
    aged = (datetime.now(timezone.utc) - timedelta(seconds=3600)).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")
    run.finished_at = aged
    await repositories.runs.save(db_session, run)
    await tick(db_session)
    assert (await _run(db_session)).status == "running"


async def test_image_scan_injects_finding(db_session):
    for _ in range(60):
        await tick(db_session)
        run = await _run(db_session)
        image_scan = next(s for s in run.stages if s.definition_id == "image-scan")
        if image_scan.status == "succeeded":
            break
    assert len(image_scan.findings) == 1
    assert image_scan.findings[0].finding_id == "find-missing-limits"
