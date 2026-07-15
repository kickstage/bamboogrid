import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Center, Loader, SegmentedControl, Text } from "@mantine/core";

import { fetchYbus } from "../api";
import { fixed } from "../format";
import { flushPending } from "../sync";
import { useEditor } from "../store";
import { toast } from "../toast";
import type { YbusResult } from "../types";
import { ToolWindow } from "../ui/ToolWindow";
import { useLiveRefresh } from "./useLiveRefresh";

type Mode = "mag" | "g" | "b";

// Cell size bounds (px). Max keeps a tiny matrix from ballooning; min lets a
// huge one shrink and scroll rather than collapse to sub-pixel.
const MIN_CELL = 6;
const MAX_CELL = 44;
const CHAR_W = 6;

const MODE_HELP: Record<Mode, string> = {
  mag: "|Y| — magnitude of each admittance (structure & coupling)",
  g: "G — conductance (real part, losses)",
  b: "B — susceptance (imaginary part, reactive coupling)",
};

// The value a cell encodes in the current mode.
function cellValue(mode: Mode, g: number, b: number): number {
  if (mode === "g") return g;
  if (mode === "b") return b;
  return Math.hypot(g, b);
}

type CellStyle = { fill: string; text: string };

// Text that stays readable on a given cell lightness (the heatmap fill is fixed
// regardless of light/dark theme, so the in-cell numbers must not use the
// theme's currentColor — a light cell in dark mode would render white on white).
function textOn(lightness: number): string {
  return lightness > 62 ? "#0b2e2b" : "#ffffff";
}

// Sequential teal ramp for |Y| (always >= 0): light -> saturated with magnitude.
function magColor(t: number): CellStyle {
  const l = 93 - 60 * t;
  return { fill: `hsl(174, 62%, ${l}%)`, text: textOn(l) };
}

// Diverging red/blue ramp for G/B, centered on zero. Perceptual sqrt so small
// off-diagonal terms stay visible next to the dominant diagonal.
function divColor(t: number): CellStyle {
  const m = Math.sqrt(Math.min(1, Math.abs(t)));
  const l = 96 - 56 * m;
  const sat = 12 + 68 * m;
  return { fill: `hsl(${t >= 0 ? 0 : 217}, ${sat}%, ${l}%)`, text: textOn(l) };
}

const EMPTY_CELL: CellStyle = { fill: "transparent", text: "currentColor" };

// A complex admittance as "g + bj" / "g − bj" in per-unit.
function complex(g: number, b: number): string {
  return `${fixed(g, 3)} ${b >= 0 ? "+" : "−"} ${fixed(Math.abs(b), 3)}j`;
}

// A floating, draggable panel showing the bus admittance matrix as a heatmap.
// Kept out of a modal on purpose: the diagram stays visible so hovering a cell
// can spotlight the two buses it couples. Re-fetches on open (and on demand)
// since the matrix goes stale after edits.
export function YbusPanel() {
  const open = useEditor((s) => s.ybusOpen);
  const setYbusOpen = useEditor((s) => s.setYbusOpen);
  const sessionId = useEditor((s) => s.sessionId);
  const highlightElement = useEditor((s) => s.highlightElement);
  const revealElement = useEditor((s) => s.revealElement);

  const [data, setData] = useState<YbusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("mag");
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);

  // A quiet reload (live auto-refresh) keeps the current matrix on screen and
  // swaps in new data when it arrives, instead of flashing the loader. The
  // request id guards against an earlier in-flight fetch overwriting a newer one.
  const reqIdRef = useRef(0);
  const load = useMemo(
    () => async (quiet = false) => {
      if (!sessionId) return;
      const myId = ++reqIdRef.current;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        await flushPending();
        const result = await fetchYbus(sessionId);
        if (reqIdRef.current === myId) setData(result);
      } catch (err) {
        if (reqIdRef.current !== myId) return;
        setData(null); // drop the stale matrix so only the error shows
        setError((err as Error).message);
        if (!quiet) toast.error("Could not build the admittance matrix.");
      } finally {
        if (reqIdRef.current === myId && !quiet) setLoading(false);
      }
    },
    [sessionId],
  );

  useLiveRefresh(open, load);

  // Clear the canvas spotlight when leaving the matrix entirely.
  useEffect(() => {
    if (!open) setHover(null);
  }, [open]);

  const n = data?.buses.length ?? 0;

  // Sparse cell lookup and per-mode color domain.
  const { byCell, colorOf } = useMemo(() => {
    const map = new Map<number, { g: number; b: number }>();
    const none: (g: number, b: number) => CellStyle = () => EMPTY_CELL;
    if (!data) return { byCell: map, colorOf: none };
    for (const e of data.entries) map.set(e.i * n + e.j, { g: e.g, b: e.b });

    const values = data.entries.map((e) => cellValue(mode, e.g, e.b));
    if (mode === "mag") {
      const positive = values.filter((v) => v > 0);
      const lo = Math.log10(Math.min(...positive));
      const hi = Math.log10(Math.max(...positive));
      const span = hi - lo || 1;
      return {
        byCell: map,
        colorOf: (g: number, b: number): CellStyle => {
          const v = Math.hypot(g, b);
          if (v <= 0) return EMPTY_CELL;
          return magColor(Math.min(1, Math.max(0, (Math.log10(v) - lo) / span)));
        },
      };
    }
    const maxAbs = Math.max(1e-12, ...values.map(Math.abs));
    return {
      byCell: map,
      colorOf: (g: number, b: number): CellStyle =>
        divColor(cellValue(mode, g, b) / maxAbs),
    };
  }, [data, mode, n]);

  // Size the label gutters to the actual labels (numeric buses need far less
  // room than fused names like "Bus 3 + Bus 4"), so the grid stays centered
  // instead of floating in an oversized left/top margin.
  const maxChars = Math.min(
    16,
    (data?.buses ?? []).reduce((m, b) => Math.max(m, b.label.length), 2),
  );
  const headL = Math.round(maxChars * CHAR_W + 10);
  const headT = Math.round(maxChars * CHAR_W * 0.72 + 14);

  // Live size of the area the grid may occupy. Height is only constrained in a
  // popped-out window (a real window height to fill); docked, it grows with the
  // grid. Measured via ResizeObserver + the owning window's resize so the matrix
  // rescales as that window is resized.
  const [box, setBox] = useState<{ w: number; h: number }>({
    w: 0,
    h: Infinity,
  });
  const roRef = useRef<ResizeObserver | null>(null);
  const measureRef = useRef<(() => void) | null>(null);
  const winRef = useRef<Window | null>(null);
  const matrixRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (winRef.current && measureRef.current) {
      winRef.current.removeEventListener("resize", measureRef.current);
    }
    roRef.current = null;
    winRef.current = null;
    measureRef.current = null;
    if (!el) return;
    const win = el.ownerDocument.defaultView;
    if (!win) return;
    const measure = () => {
      // Docked: height grows with the grid (Infinity → width governs cell size).
      // Popped out: the box flex-fills the window, so its measured height is the
      // real space to fit into.
      const detached = win !== window;
      setBox({
        w: el.clientWidth,
        h: detached ? el.clientHeight : Infinity,
      });
    };
    measureRef.current = measure;
    winRef.current = win;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
    win.addEventListener("resize", measure);
    measure();
  }, []);

  // Fit square cells to the smaller of the available width/height, capped.
  const availW = box.w > 0 ? box.w - headL - 12 : 0;
  const fitW = availW > 0 ? Math.floor(availW / Math.max(1, n)) : MAX_CELL;
  const fitH =
    box.h === Infinity
      ? MAX_CELL
      : Math.floor((box.h - headT - 8) / Math.max(1, n));
  const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.min(fitW, fitH)));

  // Numbers only fit (and only aid learning) on small matrices with room.
  const showNumbers = n > 0 && n <= 12 && cell >= 18;
  const svgW = headL + n * cell + 6;
  const svgH = headT + n * cell + 6;
  const rowMaxChars = Math.max(2, Math.floor((headL - 8) / CHAR_W));

  // Initial docked/pop-out size, derived from n alone (not the live cell) so it
  // stays stable; the grid then rescales freely inside it.
  const baseCell = Math.max(16, Math.min(MAX_CELL, Math.round(520 / Math.max(1, n))));
  const width = data ? Math.min(headL + n * baseCell + 40, 680) : 320;
  const height = data
    ? Math.min(headT + n * baseCell + 200, 820)
    : 480;

  const hoveredDetail = () => {
    if (!data || !hover) return null;
    const c = byCell.get(hover.i * n + hover.j);
    const bi = data.buses[hover.i];
    const bj = data.buses[hover.j];
    const pair =
      hover.i === hover.j ? bi.label : `${bi.label} ↔ ${bj.label}`;
    return (
      <Text size="xs" ff="monospace">
        Y[{hover.i}, {hover.j}] = {c ? complex(c.g, c.b) : "0"} p.u. · {pair}
      </Text>
    );
  };

  return (
    <ToolWindow
      title="Admittance matrix"
      opened={open}
      onClose={() => setYbusOpen(false)}
      width={width}
      height={height}
    >
      <>
        <SegmentedControl
          // Mantine positions the active indicator from a ResizeObserver bound
          // to the main-window realm, which never fires for this control once
          // it's portaled into a popup. Remount it when the container width
          // changes so it re-measures on resize instead of only on hover.
          key={`mode-${Math.round(box.w)}`}
          fullWidth
          size="xs"
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          data={[
            { label: "|Y|", value: "mag" },
            { label: "G", value: "g" },
            { label: "B", value: "b" },
          ]}
        />
        <Text size="xs" c="dimmed" mt={4} mb={2}>
          {MODE_HELP[mode]}
        </Text>

        {loading || !data ? (
          <Center py="xl">
            {error ? (
              <Text c="red" size="sm">
                {error}
              </Text>
            ) : (
              <Loader size="sm" />
            )}
          </Center>
        ) : n === 0 ? (
          <Text size="sm" c="dimmed" py="md">
            {data.message || "No buses to show yet."}
          </Text>
        ) : (
          <>
            {!data.converged && data.message && (
              <Text size="xs" c="orange" mb={4}>
                Load flow did not converge — the matrix reflects topology only.
              </Text>
            )}
            <div
              ref={matrixRef}
              style={{
                flex: 1,
                minHeight: 0,
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "auto",
              }}
            >
              <svg
                width={svgW}
                height={svgH}
                style={{
                  fontFamily: "var(--mantine-font-family-monospace)",
                  display: "block",
                  flex: "0 0 auto",
                }}
                onMouseLeave={() => {
                  setHover(null);
                  highlightElement(null);
                }}
              >
                {data.buses.map((bus, idx) => {
                  const x = headL + idx * cell;
                  const y = headT + idx * cell;
                  const active = hover?.i === idx || hover?.j === idx;
                  const label =
                    bus.label.length > rowMaxChars
                      ? bus.label.slice(0, rowMaxChars - 1) + "…"
                      : bus.label;
                  const interactive = bus.ids.length > 0;
                  return (
                    <g key={idx}>
                      {/* Column header (rotated) */}
                      <text
                        x={x + cell / 2}
                        y={headT - 6}
                        fontSize={10}
                        textAnchor="start"
                        transform={`rotate(-45, ${x + cell / 2}, ${headT - 6})`}
                        fill={
                          active
                            ? "var(--mantine-color-teal-7)"
                            : "var(--mantine-color-dimmed)"
                        }
                        fontWeight={active ? 700 : 400}
                        style={{ cursor: interactive ? "pointer" : "default" }}
                        onMouseEnter={() =>
                          interactive && highlightElement(bus.ids)
                        }
                        onClick={() =>
                          interactive && revealElement(bus.ids[0])
                        }
                      >
                        {label}
                      </text>
                      {/* Row header */}
                      <text
                        x={headL - 6}
                        y={y + cell / 2}
                        fontSize={10}
                        textAnchor="end"
                        dominantBaseline="central"
                        fill={
                          active
                            ? "var(--mantine-color-teal-7)"
                            : "var(--mantine-color-dimmed)"
                        }
                        fontWeight={active ? 700 : 400}
                        style={{ cursor: interactive ? "pointer" : "default" }}
                        onMouseEnter={() =>
                          interactive && highlightElement(bus.ids)
                        }
                        onClick={() =>
                          interactive && revealElement(bus.ids[0])
                        }
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}

                {/* Cells */}
                {data.buses.map((_, i) =>
                  data.buses.map((__, j) => {
                    const c = byCell.get(i * n + j);
                    const x = headL + j * cell;
                    const y = headT + i * cell;
                    const style = c ? colorOf(c.g, c.b) : EMPTY_CELL;
                    const hovered = hover?.i === i && hover?.j === j;
                    const val = c ? cellValue(mode, c.g, c.b) : 0;
                    return (
                      <g key={`${i}-${j}`}>
                        <rect
                          x={x}
                          y={y}
                          width={cell}
                          height={cell}
                          fill={style.fill}
                          stroke={
                            hovered
                              ? "var(--mantine-color-teal-7)"
                              : "var(--mantine-color-gray-3)"
                          }
                          strokeWidth={hovered ? 2 : 0.5}
                          onMouseEnter={() => {
                            setHover({ i, j });
                            const ids = [
                              ...data.buses[i].ids,
                              ...data.buses[j].ids,
                            ];
                            highlightElement(ids);
                          }}
                        >
                          <title>
                            {`Y[${i},${j}] = ${
                              c ? complex(c.g, c.b) : "0"
                            } p.u.`}
                          </title>
                        </rect>
                        {showNumbers && c && (
                          <text
                            x={x + cell / 2}
                            y={y + cell / 2}
                            fontSize={8}
                            textAnchor="middle"
                            dominantBaseline="central"
                            pointerEvents="none"
                            fill={style.text}
                          >
                            {fixed(val, Math.abs(val) >= 100 ? 0 : 1)}
                          </text>
                        )}
                      </g>
                    );
                  }),
                )}
              </svg>
            </div>

            <div style={{ minHeight: 18, marginTop: 4 }}>
              {hoveredDetail() ?? (
                <Text size="xs" c="dimmed">
                  Hover a cell to inspect it; click a bus name to jump to it.
                </Text>
              )}
            </div>
            <Text size="xs" c="dimmed" mt={2}>
              Per-unit on {fixed(data.sn_mva, 0)} MVA base.
              {data.omitted_buses > 0 &&
                ` ${data.omitted_buses} bus${
                  data.omitted_buses === 1 ? "" : "es"
                } omitted (out of service or isolated).`}
            </Text>
          </>
        )}
      </>
    </ToolWindow>
  );
}
