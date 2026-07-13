import { useEffect, useState } from "react";
import { fetchStdTypes, type StdTrafoTypes } from "../api";
import type {
  Trafo2WData,
  Trafo2WParams,
  Trafo3WData,
  Trafo3WParams,
} from "../types";

// A transformer node stores explicit params only once it's custom; a std_type
// transformer carries none, so its effective params come from the (cached)
// pandapower catalog. Resolves either source, fetching the catalog lazily only
// when the node actually needs it.
export function useTrafoParams(
  data: Trafo2WData | Trafo3WData,
  table: "trafo" | "trafo3w",
): Trafo2WParams | Trafo3WParams | undefined {
  const [std, setStd] = useState<StdTrafoTypes>();
  const needCatalog = !data.params && !!data.std_type;
  useEffect(() => {
    if (!needCatalog) return;
    fetchStdTypes(table)
      .then(setStd)
      .catch(() => {});
  }, [needCatalog, table]);

  if (data.params) return data.params;
  if (data.std_type && std)
    return std[data.std_type] as unknown as Trafo2WParams | Trafo3WParams;
  return undefined;
}
