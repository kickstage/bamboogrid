"""Integration test: the IEEE 14-bus case must import and solve to the same
result pandapower gives for the canonical network. This exercises the pieces
that make a real net faithful — transformer parameters *and tap changers*,
shunts, lines, and the system frequency — together."""

import pandapower as pp
import pandapower.networks as nw

from app.converter import run_load_flow
from app.ppjson import pp_json_to_network


def test_ieee14_imports_taps_and_shunt():
    net = pp_json_to_network(pp.to_json(nw.case14()))
    # The shunt (−19 MVar at one bus) is captured...
    assert len(net.shunts) == 1
    assert net.shunts[0].q_mvar == -19.0
    # ...and the three tap-changing transformers keep their tap position.
    tapped = [t for t in net.transformers2w if t.params and t.params.tap_pos is not None]
    assert len(tapped) == 3
    assert tapped[0].params.tap_changer_type == "Ratio"


def test_ieee14_solution_matches_reference():
    ref = nw.case14()
    pp.runpp(ref)

    net = pp_json_to_network(pp.to_json(nw.case14()))
    result = run_load_flow(net)
    assert result.converged

    # res_bus follows the bus build order, which mirrors the reference net's.
    diffs = [
        abs(r.vm_pu - ref.res_bus.vm_pu.iloc[i])
        for i, r in enumerate(result.res_bus)
    ]
    assert max(diffs) < 1e-6, f"max bus voltage diff {max(diffs)}"
