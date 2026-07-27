from secureflow_api import state
from secureflow_api.simulator import SIMULATED_RUN_ID, tick


def _run(st):
    return next(r for r in st.runs if r.id == SIMULATED_RUN_ID)


def test_tick_advances_the_running_stage():
    st = state.get_state()
    run = _run(st)
    assert run.status == "running", "fixture assumption: run-0512 ships mid-flight"
    running_idx = next(i for i, s in enumerate(run.stages) if s.status == "running")
    tick(st)
    assert run.stages[running_idx].status == "succeeded"
    assert run.stages[running_idx].finished_at is not None


def test_run_completes_and_restarts_after_idle():
    st = state.get_state()
    run = _run(st)
    for _ in range(60):  # plenty of ticks to reach completion
        tick(st)
        if run.status == "succeeded":
            break
    assert run.status == "succeeded"
    assert run.security_gate == "passed"
    assert all(s.status != "pending" for s in run.stages)
    for _ in range(5):  # idle period, then restart
        tick(st)
    assert run.status == "running"


def test_image_scan_injects_finding():
    st = state.get_state()
    run = _run(st)
    for _ in range(60):
        tick(st)
        image_scan = next(s for s in run.stages if s.definition_id == "image-scan")
        if image_scan.status == "succeeded":
            break
    assert len(image_scan.findings) == 1
    assert image_scan.findings[0].finding_id == "find-missing-limits"
