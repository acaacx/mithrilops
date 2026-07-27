from secureflow_api import state


def test_state_is_seeded_and_isolated_from_fixture_cache():
    st = state.get_state()
    assert len(st.runs) > 0
    original_status = st.runs[0].status
    st.runs[0].status = "cancelled"
    state.reset_state()
    assert state.get_state().runs[0].status == original_status


def test_record_audit_prepends_event_with_sequential_id():
    st = state.get_state()
    before = len(st.audit)
    event = state.record_audit(
        st,
        actor="You",
        actor_role="devsecops-engineer",
        action="test.action",
        target="unit-test",
        target_type="Test",
        outcome="success",
        detail="unit test event",
    )
    assert event.id == "aud-101"
    assert len(st.audit) == before + 1
    assert st.audit[0].id == event.id
    assert state.record_audit(
        st,
        actor="You",
        actor_role="devsecops-engineer",
        action="test.action",
        target="unit-test",
        target_type="Test",
        outcome="success",
        detail="second",
    ).id == "aud-102"
