"""Regenerate the numbered tutorial networks (01–03) in this folder.

Run from the backend (so the ``app`` package and pandapower are importable):

    cd backend
    .venv/bin/python ../examples/generate_examples.py

Each network is written as a plain pandapower JSON (no editor layout tables), so
the editor lays it out automatically on import. See README.md for what each one
demonstrates.
"""

from __future__ import annotations

import os

import pandapower as pp

EX = os.path.dirname(os.path.abspath(__file__))


def main() -> None:
    # 01 — external grid + load + static generator (one MV bus).
    n1 = pp.create_empty_network(name="01 - External grid, load, sgen")
    b = pp.create_bus(n1, vn_kv=20.0, name="MV bus")
    pp.create_ext_grid(n1, bus=b, vm_pu=1.0, name="Grid connection")
    pp.create_load(n1, bus=b, p_mw=3.0, q_mvar=1.0, name="Town load")
    pp.create_sgen(n1, bus=b, p_mw=1.0, q_mvar=0.0, name="Rooftop PV")
    pp.to_json(n1, os.path.join(EX, "01_extgrid_load_sgen.pp.json"))

    # 02 — 2-winding transformer + dispatchable generator.
    n2 = pp.create_empty_network(name="02 - Transformer and generator")
    hv = pp.create_bus(n2, vn_kv=110.0, name="HV grid")
    mv = pp.create_bus(n2, vn_kv=20.0, name="MV bus")
    pp.create_ext_grid(n2, bus=hv, vm_pu=1.0, name="Grid connection")
    pp.create_transformer(n2, hv_bus=hv, lv_bus=mv, std_type="25 MVA 110/20 kV", name="Main trafo")
    pp.create_load(n2, bus=mv, p_mw=10.0, q_mvar=3.0, name="Factory load")
    pp.create_gen(n2, bus=mv, p_mw=4.0, vm_pu=1.0, name="CHP generator")
    pp.create_sgen(n2, bus=mv, p_mw=2.0, q_mvar=0.0, name="Solar farm")
    pp.to_json(n2, os.path.join(EX, "02_transformer_generator.pp.json"))

    # 03 — full substation: 3W transformer + bus-coupler switch.
    n3 = pp.create_empty_network(name="03 - Substation with 3W transformer and switch")
    hv = pp.create_bus(n3, vn_kv=110.0, name="HV grid")
    mv1 = pp.create_bus(n3, vn_kv=20.0, name="MV bus A")
    mv2 = pp.create_bus(n3, vn_kv=20.0, name="MV bus B")
    lv = pp.create_bus(n3, vn_kv=10.0, name="LV bus")
    pp.create_ext_grid(n3, bus=hv, vm_pu=1.0, name="Grid connection")
    pp.create_transformer3w(n3, hv_bus=hv, mv_bus=mv1, lv_bus=lv,
                            std_type="63/25/38 MVA 110/20/10 kV", name="Substation trafo")
    pp.create_switch(n3, bus=mv1, element=mv2, et="b", closed=True, name="Bus coupler")
    pp.create_load(n3, bus=mv1, p_mw=8.0, q_mvar=2.0, name="District A")
    pp.create_load(n3, bus=mv2, p_mw=5.0, q_mvar=1.0, name="District B")
    pp.create_sgen(n3, bus=mv1, p_mw=3.0, q_mvar=0.0, name="Wind feed-in")
    pp.create_load(n3, bus=lv, p_mw=6.0, q_mvar=2.0, name="Rail supply")
    pp.to_json(n3, os.path.join(EX, "03_substation_3w_switch.pp.json"))

    print("Wrote 01–03 example networks to", EX)


if __name__ == "__main__":
    main()
