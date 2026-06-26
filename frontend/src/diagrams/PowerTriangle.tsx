import { Stack, Text } from "@mantine/core";
import { fixed } from "../format";
import { apparentPower, phaseAngleDeg, powerFactor } from "../power";

const P_COLOR = "#2563eb";
const Q_COLOR = "#d97706";
const S_COLOR = "#16a34a";
const LABEL = "#9ca3af";

type Pt = { x: number; y: number };

const mid = (u: Pt, v: Pt): Pt => ({ x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 });

// Edge labels are offset perpendicular to their own edge, away from the opposite
// vertex, with the text anchor chosen from the normal's direction so a wide label
// extends away from the line rather than across it. This keeps labels off the
// strokes even for a very thin triangle (|Q| ≫ |P|), where the S and Q legs are
// nearly parallel.
function placeLabel(base: Pt, nx: number, ny: number, dist: number) {
  const len = Math.hypot(nx, ny) || 1;
  const ux = nx / len;
  const uy = ny / len;
  return {
    x: base.x + ux * dist,
    y: base.y + uy * dist,
    anchor: Math.abs(ux) < 0.35 ? "middle" : ux > 0 ? "start" : "end",
    baseline: Math.abs(uy) < 0.35 ? "middle" : uy > 0 ? "hanging" : "alphabetic",
  } as const;
}

// Outward normal of edge v1→v2, flipped to point away from the opposite vertex.
function edgeNormal(v1: Pt, v2: Pt, vop: Pt) {
  let nx = -(v2.y - v1.y);
  let ny = v2.x - v1.x;
  const m = mid(v1, v2);
  if (nx * (vop.x - m.x) + ny * (vop.y - m.y) > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny };
}

// A scale drawing of the power triangle: active power P along the horizontal,
// reactive power Q along the vertical, apparent power S as the hypotenuse, with
// the power-factor angle φ at the origin. The three vertices are fit to the
// viewport's bounding box, so the whole triangle stays visible whichever leg
// dominates and whatever the sign of Q (up for lagging, down for leading).
export function PowerTriangle({ p, q }: { p: number; q: number }) {
  const s = apparentPower(p, q);
  const pf = powerFactor(p, q);
  const phi = phaseAngleDeg(p, q);

  const W = 340;
  const H = 250;
  const padX = 64;
  const padY = 44;

  // Triangle vertices in data space (y up): origin, end of P, end of S.
  const O: Pt = { x: 0, y: 0 };
  const A: Pt = { x: p, y: 0 };
  const B: Pt = { x: p, y: q };
  const minX = Math.min(O.x, A.x, B.x);
  const maxX = Math.max(O.x, A.x, B.x);
  const minY = Math.min(O.y, A.y, B.y);
  const maxY = Math.max(O.y, A.y, B.y);
  const scale = Math.min(
    (W - 2 * padX) / Math.max(maxX - minX, 1e-9),
    (H - 2 * padY) / Math.max(maxY - minY, 1e-9),
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const map = (pt: Pt): Pt => ({
    x: W / 2 + (pt.x - cx) * scale,
    y: H / 2 - (pt.y - cy) * scale,
  });
  const sO = map(O);
  const sA = map(A);
  const sB = map(B);
  const centroid: Pt = {
    x: (sO.x + sA.x + sB.x) / 3,
    y: (sO.y + sA.y + sB.y) / 3,
  };

  const pN = edgeNormal(sO, sA, sB);
  const qN = edgeNormal(sA, sB, sO);
  const sN = edgeNormal(sO, sB, sA);
  const pLabel = placeLabel(mid(sO, sA), pN.nx, pN.ny, 10);
  const qLabel = placeLabel(mid(sA, sB), qN.nx, qN.ny, 8);
  const sLabel = placeLabel(mid(sO, sB), sN.nx, sN.ny, 8);
  // φ sits at the origin corner, nudged outward (away from the triangle) so it
  // clears both the P and S strokes.
  const phiLabel = placeLabel(sO, sO.x - centroid.x, sO.y - centroid.y, 18);

  return (
    <Stack gap="sm">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: 380, alignSelf: "center" }}
      >
        <line x1={sO.x} y1={sO.y} x2={sA.x} y2={sA.y} stroke={P_COLOR} strokeWidth={2.5} />
        <line x1={sA.x} y1={sA.y} x2={sB.x} y2={sB.y} stroke={Q_COLOR} strokeWidth={2.5} />
        <line x1={sO.x} y1={sO.y} x2={sB.x} y2={sB.y} stroke={S_COLOR} strokeWidth={2.5} />

        <text
          x={pLabel.x}
          y={pLabel.y}
          fill={P_COLOR}
          fontSize={12}
          textAnchor={pLabel.anchor}
          dominantBaseline={pLabel.baseline}
        >
          P {fixed(p, 2)} MW
        </text>
        <text
          x={qLabel.x}
          y={qLabel.y}
          fill={Q_COLOR}
          fontSize={12}
          textAnchor={qLabel.anchor}
          dominantBaseline={qLabel.baseline}
        >
          Q {fixed(q, 2)} Mvar
        </text>
        <text
          x={sLabel.x}
          y={sLabel.y}
          fill={S_COLOR}
          fontSize={12}
          textAnchor={sLabel.anchor}
          dominantBaseline={sLabel.baseline}
        >
          S {fixed(s, 2)} MVA
        </text>

        <circle cx={sO.x} cy={sO.y} r={3} fill={LABEL} />
        <text
          x={phiLabel.x}
          y={phiLabel.y}
          fill={LABEL}
          fontSize={11}
          textAnchor={phiLabel.anchor}
          dominantBaseline={phiLabel.baseline}
        >
          φ {fixed(phi, 1)}°
        </text>
      </svg>

      <Text size="sm" ta="center">
        Power factor {fixed(pf.value, 3)}
        {pf.sense !== "unity" ? ` ${pf.sense}` : ""}
      </Text>
    </Stack>
  );
}
