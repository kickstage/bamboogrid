import type { EdgeTypes } from "@xyflow/react";
import { LineEdge } from "./LineEdge";
import { WireEdge } from "./WireEdge";

export const edgeTypes: EdgeTypes = {
  wire: WireEdge,
  line: LineEdge,
};
