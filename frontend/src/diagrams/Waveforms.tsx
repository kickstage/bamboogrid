import { Stack, Text } from "@mantine/core";
import { fixed } from "../format";
import { phaseAngleDeg, powerFactor } from "../power";

const V_COLOR = "#2563eb";
const I_COLOR = "#dc2626";

const CYCLES = 2;
const SAMPLES = 160;

// Voltage and current as time waveforms separated by the power-factor angle φ.
// The current is drawn at sin(x − φ): it peaks earlier than the voltage for a
// leading power factor (φ < 0) and later for a lagging one. Both are normalised
// to the same amplitude — the diagram is about the phase shift, not magnitude.
export function Waveforms({ p, q }: { p: number; q: number }) {
  const phi = phaseAngleDeg(p, q);
  const phiRad = (phi * Math.PI) / 180;
  const pf = powerFactor(p, q);
  const mag = Math.abs(phi);

  // Caption is driven by φ itself, not the sign of Q alone: negative real power
  // (e.g. a generator running as a motor) gives φ ≈ ±180°, so the current is
  // antiphase even at unity power factor — calling that "in phase" would be wrong.
  const caption =
    mag < 0.1
      ? "Current in phase with voltage (unity pf)"
      : mag > 179.9
        ? "Current antiphase with voltage — absorbs real power (unity pf)"
        : `Current ${fixed(mag, 1)}° ${phi < 0 ? "leading" : "lagging"} (pf ${fixed(pf.value, 3)})`;

  const W = 320;
  const H = 200;
  const padX = 12;
  const midY = H / 2;
  const amp = H / 2 - 24;
  const xMax = CYCLES * 2 * Math.PI;

  const wave = (shift: number) => {
    const pts: string[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = (i / SAMPLES) * xMax;
      const x = padX + (i / SAMPLES) * (W - 2 * padX);
      const y = midY - amp * Math.sin(t - shift);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(" ");
  };

  return (
    <Stack gap="sm">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: 360, alignSelf: "center" }}
      >
        <line x1={padX} y1={midY} x2={W - padX} y2={midY} stroke="#e5e7eb" />
        <polyline
          points={wave(0)}
          fill="none"
          stroke={V_COLOR}
          strokeWidth={2.5}
        />
        <polyline
          points={wave(phiRad)}
          fill="none"
          stroke={I_COLOR}
          strokeWidth={2.5}
        />
        <text x={padX + 4} y={16} fill={V_COLOR} fontSize={12} fontWeight={600}>
          V
        </text>
        <text x={padX + 22} y={16} fill={I_COLOR} fontSize={12} fontWeight={600}>
          I
        </text>
      </svg>

      <Text size="sm" ta="center">
        {caption}
      </Text>
    </Stack>
  );
}
