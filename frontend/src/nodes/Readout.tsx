import type { ReactNode } from "react";

// The inner block: monospace so figures line up column-wise; left-aligned; nowrap
// so a value never breaks from its unit ("1.234" / "MW"). It's inline-block so it
// shrinks to its content and sits centred under a centre-aligned node while its
// own lines align left.
const inner = {
  fontFamily: "var(--mantine-font-family-monospace, ui-monospace, monospace)",
  textAlign: "left" as const,
  whiteSpace: "nowrap" as const,
  display: "inline-block",
};

// Each readout is wrapped in a block-level row so consecutive ones (e.g. a bus's
// nominal-voltage Value and its load-flow Readout) stack vertically instead of
// flowing onto the same line. The row's own font-size/line-height are pinned to
// the content size so the inline-block doesn't inherit the app's larger line box
// (which would leave a tall empty gap above each row).
function Row({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 9, lineHeight: 1.2 }}>{children}</div>;
}

// The dim parameter line under an element's name (e.g. "5 MW", "20 kV").
export function Value({ children }: { children: ReactNode }) {
  return (
    <Row>
      <div style={{ ...inner, fontSize: 9, opacity: 0.7 }}>{children}</div>
    </Row>
  );
}

// The blue load-flow readout shown once a flow has solved. `color` overrides the
// default (e.g. red for an overloaded transformer/line).
export function Readout({
  color = "#0ea5e9",
  children,
}: {
  color?: string;
  children: ReactNode;
}) {
  return (
    <Row>
      <div style={{ ...inner, fontSize: 9, fontWeight: 600, lineHeight: 1.2, color }}>
        {children}
      </div>
    </Row>
  );
}
