import type { Trafo2WData, Trafo3WData } from "../types";
import { Readout } from "./Readout";
import { signed } from "../format";

// Compact load-flow readout shown under a transformer: loading % (red when
// overloaded) and HV-side through-power.
export function TransformerResult({ data }: { data: Trafo2WData | Trafo3WData }) {
  const loading = data.res_loading_percent;
  if (loading === undefined) return null;
  const overloaded = loading > 100;
  return (
    <Readout color={overloaded ? "#dc2626" : "#0ea5e9"}>
      <div>{signed(loading, 1)}%</div>
      {data.res_p_mw !== undefined && <div>{signed(data.res_p_mw, 3)} MW</div>}
    </Readout>
  );
}
