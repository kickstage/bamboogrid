import type { NodeTypes } from "@xyflow/react";
import { BusNode } from "./BusNode";
import { GeneratorNode } from "./GeneratorNode";
import { LoadNode } from "./LoadNode";

export const nodeTypes: NodeTypes = {
  bus: BusNode,
  generator: GeneratorNode,
  load: LoadNode,
};
