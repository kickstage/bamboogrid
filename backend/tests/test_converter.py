import pytest

from app.converter import ConversionError, run_load_flow, validate
from app.schema import Bus, Generator, Load, Network


def one_bus_with_slack_gen() -> Network:
    return Network(
        id="t1",
        name="one-bus",
        buses=[Bus(id="b1", vn_kv=0.4)],
        generators=[
            Generator(id="g1", bus_id="b1", p_mw=0.0, vm_pu=1.02, slack=True)
        ],
        loads=[Load(id="l1", bus_id="b1", p_mw=0.01)],
    )


def test_slack_generator_is_the_reference():
    result = run_load_flow(one_bus_with_slack_gen())
    assert result.converged, result.message
    assert result.res_bus[0].vm_pu == pytest.approx(1.02, abs=1e-6)


def test_non_solving_net_is_allowed_but_not_converged():
    # A load with no slack anywhere: we don't reject it — it just doesn't solve.
    net = Network(
        id="t2",
        buses=[Bus(id="b1")],
        loads=[Load(id="l1", bus_id="b1", p_mw=0.01)],
    )
    validate(net)  # no exception — structurally fine
    assert not run_load_flow(net).converged


def test_non_slack_generator_alone_does_not_converge():
    net = Network(
        id="t3",
        buses=[Bus(id="b1")],
        generators=[Generator(id="g1", bus_id="b1", p_mw=1.0, vm_pu=1.0, slack=False)],
    )
    assert not run_load_flow(net).converged


def test_unknown_bus_reference_is_rejected():
    net = Network(
        id="t4",
        buses=[Bus(id="b1")],
        generators=[Generator(id="g1", bus_id="nope", slack=True)],
    )
    with pytest.raises(ConversionError):
        validate(net)


def test_unwired_element_is_ignored():
    net = Network(
        id="t5",
        buses=[Bus(id="b1")],
        generators=[Generator(id="g1", bus_id="b1", slack=True)],
        loads=[Load(id="l1", bus_id="", p_mw=0.01)],  # not placed yet
    )
    assert run_load_flow(net).converged
