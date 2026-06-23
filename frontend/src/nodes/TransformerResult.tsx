import type { Trafo2WData, Trafo3WData } from "../types";

// Compact load-flow readout shown under a transformer: loading % (red when
// overloaded) and HV-side through-power.
export function TransformerResult({ data }: { data: Trafo2WData | Trafo3WData }) {
  const loading = data.res_loading_percent;
  if (loading === undefined) return null;
  const overloaded = loading > 100;
  return (
    <div style={{ fontSize: 9, fontWeight: 600, color: overloaded ? "#dc2626" : "#0ea5e9" }}>
      <div>{loading.toFixed(1)}%</div>
      {data.res_p_mw !== undefined && <div>{data.res_p_mw.toFixed(3)} MW</div>}
    </div>
  );
}
