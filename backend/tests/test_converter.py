import pytest

from app.converter import ConversionError, run_load_flow, validate
from app.schema import Bus, Generator, Load, Network


def make_one_bus_network() -> Network:
    return Network(
        id="t1",
        name="one-bus",
        buses=[Bus(id="b1", vn_kv=0.4)],
        generators=[Generator(id="g1", bus_id="b1", vm_pu=1.02)],
        loads=[Load(id="l1", bus_id="b1", p_mw=0.01, q_mvar=0.0)],
    )


def test_one_bus_converges_at_setpoint():
    result = run_load_flow(make_one_bus_network())
    assert result.converged, result.message
    assert len(result.res_bus) == 1
    # ext_grid holds the slack bus at its voltage setpoint.
    assert result.res_bus[0].vm_pu == pytest.approx(1.02, abs=1e-6)


def test_load_without_generator_is_rejected():
    net = Network(
        id="t2",
        buses=[Bus(id="b1")],
        loads=[Load(id="l1", bus_id="b1", p_mw=0.01)],
    )
    with pytest.raises(ConversionError):
        validate(net)
    # run_load_flow surfaces it as a non-converged result rather than raising.
    result = run_load_flow(net)
    assert not result.converged
    assert "reference" in result.message.lower()


def test_unknown_bus_reference_is_rejected():
    net = Network(
        id="t3",
        buses=[Bus(id="b1")],
        generators=[Generator(id="g1", bus_id="does-not-exist")],
    )
    with pytest.raises(ConversionError):
        validate(net)
