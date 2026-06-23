import type { NodeTypes } from "@xyflow/react";
import { BusNode } from "./BusNode";
import { GeneratorNode } from "./GeneratorNode";
import { SgenNode } from "./SgenNode";
import { ExtGridNode } from "./ExtGridNode";
import { LoadNode } from "./LoadNode";
import { SwitchNode } from "./SwitchNode";
import { Transformer2WNode } from "./Transformer2WNode";
import { Transformer3WNode } from "./Transformer3WNode";

export const nodeTypes: NodeTypes = {
  bus: BusNode,
  generator: GeneratorNode,
  sgen: SgenNode,
  extgrid: ExtGridNode,
  load: LoadNode,
  switch: SwitchNode,
  trafo2w: Transformer2WNode,
  trafo3w: Transformer3WNode,
};
