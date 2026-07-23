import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Center, Group, Loader, Select, Text } from "@mantine/core";

import { fetchJacobian } from "../api";
import { fixed } from "../format";
import { flushPending } from "../sync";
import { useEditor } from "../store";
import { toast } from "../toast";
import type { JacobianCol, JacobianResult } from "../types";
import { ToolWindow } from "../ui/ToolWindow";
// Cells use the diverging ramp (signed sensitivities); the blank zero cells are
// the "this measurement can't see that state" structure worth showing.
import {
  CHAR_W,
  type CellStyle,
  divColor,
  EMPTY_CELL,
  MAX_CELL,
  MIN_CELL,
} from "./heatmap";
import { useLiveRefresh } from "./useLiveRefresh";

// Select value standing in for "no focus" (Mantine Select can't hold null).
const ALL = "__all__";

// Strip the "∠ " / "|V| " state prefix to get the underlying bus name.
const busName = (label: string) => label.replace(/^(?:∠|\|V\|)\s+/, "");

// A stable key for the bus a state column belongs to: its editor id(s) when it
// has them, else the (internal-node) name. Both the ∠ and |V| column of a bus
// share this key, so focusing on it selects the pair.
const colKey = (c: JacobianCol) =>
  c.ids.length ? c.ids.join(",") : busName(c.label);

// A floating panel showing the measurement Jacobian H (∂h/∂x) as a heatmap.
// Rows are the measurements, columns are the states (bus voltage angles then
// magnitudes). Mirrors YbusPanel's mechanics: the diagram stays visible so
// hovering a cell spotlights the measured element and the bus it couples to.
export function JacobianPanel() {
  const open = useEditor((s) => s.jacobianOpen);
  const setJacobianOpen = useEditor((s) => s.setJacobianOpen);
  const sessionId = useEditor((s) => s.sessionId);
  const highlightElement = useEditor((s) => s.highlightElement);
  const revealElement = useEditor((s) => s.revealElement);

  const [data, setData] = useState<JacobianResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  // Focus on one bus: null shows the whole matrix, otherwise a colKey.
  const [focus, setFocus] = useState<string | null>(null);

  const reqIdRef = useRef(0);
  const load = useMemo(
    () => async (quiet = false) => {
      if (!sessionId) return;
      const myId = ++reqIdRef.current;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        await flushPending();
        const result = await fetchJacobian(sessionId);
        if (reqIdRef.current === myId) setData(result);
      } catch (err) {
        if (reqIdRef.current !== myId) return;
        setData(null);
        setError((err as Error).message);
        if (!quiet) toast.error("Could not build the Jacobian.");
      } finally {
        if (reqIdRef.current === myId && !quiet) setLoading(false);
      }
    },
    [sessionId],
  );

  useLiveRefresh(open, load);

  useEffect(() => {
    if (!open) setHover(null);
  }, [open]);

  // The buses that can be focused on, in column order.
  const busOptions = useMemo(() => {
    if (!data?.ok) return [] as { key: string; label: string }[];
    const seen = new Map<string, { key: string; label: string }>();
    for (const c of data.cols) {
      const key = colKey(c);
      if (!seen.has(key)) seen.set(key, { key, label: busName(c.label) });
    }
    return [...seen.values()];
  }, [data]);

  // Drop a stale focus if a refresh removed that bus.
  useEffect(() => {
    if (focus && !busOptions.some((b) => b.key === focus)) setFocus(null);
  }, [busOptions, focus]);

  // The matrix to render. With a bus focused, keep the rows (measurements) that
  // touch it and every column (state) those rows reach — so you see the bus,
  // plus the neighbor states its measurements also couple to — then reindex.
  const view = useMemo(() => {
    if (!data?.ok) return { rows: [], cols: [], entries: [] } as const;
    const full = { rows: data.rows, cols: data.cols, entries: data.entries };
    if (!focus) return full;
    const focusCols = new Set<number>();
    data.cols.forEach((c, j) => colKey(c) === focus && focusCols.add(j));
    if (!focusCols.size) return full;
    const rowSet = new Set<number>();
    for (const e of data.entries) if (focusCols.has(e.j)) rowSet.add(e.i);
    const colSet = new Set<number>();
    for (const e of data.entries) if (rowSet.has(e.i)) colSet.add(e.j);
    const rowIdx = [...rowSet].sort((a, b) => a - b);
    const colIdx = [...colSet].sort((a, b) => a - b);
    const rowPos = new Map(rowIdx.map((r, i) => [r, i]));
    const colPos = new Map(colIdx.map((c, j) => [c, j]));
    return {
      rows: rowIdx.map((r) => data.rows[r]),
      cols: colIdx.map((c) => data.cols[c]),
      entries: data.entries
        .filter((e) => rowSet.has(e.i) && colSet.has(e.j))
        .map((e) => ({ i: rowPos.get(e.i)!, j: colPos.get(e.j)!, value: e.value })),
    };
  }, [data, focus]);

  const nRows = view.rows.length;
  const nCols = view.cols.length;

  // Sparse cell lookup and the color domain (largest absolute sensitivity).
  const { byCell, colorOf } = useMemo(() => {
    const map = new Map<number, number>();
    if (!view.entries.length)
      return { byCell: map, colorOf: () => EMPTY_CELL };
    for (const e of view.entries) map.set(e.i * view.cols.length + e.j, e.value);
    const maxAbs = Math.max(1e-12, ...view.entries.map((e) => Math.abs(e.value)));
    return {
      byCell: map,
      colorOf: (v: number): CellStyle => divColor(v / maxAbs),
    };
  }, [view]);

  // Gutters sized to the actual labels (row labels like "P Line 1-2 (from)" run
  // longer than the state labels), so the grid isn't lost in oversized margins.
  const rowChars = Math.min(
    22,
    view.rows.reduce((m, r) => Math.max(m, r.label.length), 2),
  );
  const colChars = Math.min(
    12,
    view.cols.reduce((m, c) => Math.max(m, c.label.length), 2),
  );
  const headL = Math.round(rowChars * CHAR_W + 10);
  const headT = Math.round(colChars * CHAR_W * 0.72 + 14);

  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
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
    // The panel has a definite height (fill), so the scroll box gives a stable
    // available size to fit the whole matrix into — both dimensions.
    const measure = () => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
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
  // Before the first measure both are 0 → fall back to MAX_CELL.
  const availW = box.w > 0 ? box.w - headL - 12 : 0;
  const availH = box.h > 0 ? box.h - headT - 8 : 0;
  const fitW = availW > 0 ? Math.floor(availW / Math.max(1, nCols)) : MAX_CELL;
  const fitH = availH > 0 ? Math.floor(availH / Math.max(1, nRows)) : MAX_CELL;
  const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.min(fitW, fitH)));

  // Numbers only fit (and only help) on small matrices with room to spare.
  const showNumbers = nRows > 0 && nRows <= 16 && nCols <= 12 && cell >= 20;
  const svgW = headL + nCols * cell + 6;
  const svgH = headT + nRows * cell + 6;
  const rowMaxChars = Math.max(4, Math.floor((headL - 8) / CHAR_W));

  // Initial docked/pop-out size, from the *full* matrix so the panel doesn't
  // jump when a focus filters it down (the grid then zooms-to-fit inside).
  const fullRows = data?.ok ? data.rows.length : 0;
  const fullCols = data?.ok ? data.cols.length : 0;
  const baseCell = Math.max(
    16,
    Math.min(MAX_CELL, Math.round(420 / Math.max(1, fullRows, fullCols))),
  );
  const width = data?.ok ? Math.min(headL + fullCols * baseCell + 40, 720) : 340;
  const height = data?.ok
    ? Math.min(headT + fullRows * baseCell + 200, 820)
    : 320;

  const clip = (s: string, n: number) =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;

  const hoveredDetail = () => {
    if (!hover) return null;
    const row = view.rows[hover.i];
    const col = view.cols[hover.j];
    if (!row || !col) return null;
    const v = byCell.get(hover.i * nCols + hover.j);
    return (
      <Text size="xs" ff="monospace">
        ∂({row.label}) / ∂({col.label}) = {v === undefined ? "0" : fixed(v, 3)}
      </Text>
    );
  };

  return (
    <ToolWindow
      title="Measurement Jacobian (H)"
      opened={open}
      onClose={() => setJacobianOpen(false)}
      width={width}
      height={height}
      fill
    >
      <>
        <Text size="xs" c="dimmed" mt={2} mb={4}>
          ∂(measurement) / ∂(state) at the estimated state — rows are
          measurements, columns are bus angles ∠ and magnitudes |V|.
        </Text>

        {data?.ok && busOptions.length > 1 && (
          <Group gap="xs" wrap="nowrap" mb={6} align="center">
            <Text size="xs" c="dimmed">
              Focus
            </Text>
            <Select
              size="xs"
              style={{ flex: 1 }}
              value={focus ?? ALL}
              onChange={(v) => {
                setFocus(v && v !== ALL ? v : null);
                setHover(null);
              }}
              allowDeselect={false}
              data={[
                { value: ALL, label: "All states" },
                ...busOptions.map((b) => ({ value: b.key, label: b.label })),
              ]}
            />
          </Group>
        )}

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
        ) : !data.ok ? (
          <Text size="sm" c="dimmed" py="md">
            {data.message || "Run state estimation to see the Jacobian."}
          </Text>
        ) : (
          <>
            <div
              ref={matrixRef}
              style={{
                flex: 1,
                minHeight: 0,
                width: "100%",
                display: "flex",
                // `safe` keeps the matrix centered when it fits but falls back to
                // start-aligned when it doesn't, so an overflow scrolls from the
                // top-left instead of being clipped on both sides.
                alignItems: "safe center",
                justifyContent: "safe center",
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
                {/* Column headers (states), rotated. */}
                {view.cols.map((col, j) => {
                  const x = headL + j * cell;
                  const active = hover?.j === j;
                  const interactive = col.ids.length > 0;
                  return (
                    <text
                      key={`c${j}`}
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
                        interactive && highlightElement(col.ids)
                      }
                      onClick={() => interactive && revealElement(col.ids[0])}
                    >
                      {clip(col.label, 14)}
                    </text>
                  );
                })}

                {/* Row headers (measurements). */}
                {view.rows.map((row, i) => {
                  const y = headT + i * cell;
                  const active = hover?.i === i;
                  const interactive = row.ids.length > 0;
                  return (
                    <text
                      key={`r${i}`}
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
                        interactive && highlightElement(row.ids)
                      }
                      onClick={() => interactive && revealElement(row.ids[0])}
                    >
                      {clip(row.label, rowMaxChars)}
                    </text>
                  );
                })}

                {/* Cells */}
                {view.rows.map((_, i) =>
                  view.cols.map((__, j) => {
                    const v = byCell.get(i * nCols + j);
                    const x = headL + j * cell;
                    const y = headT + i * cell;
                    const style = v === undefined ? EMPTY_CELL : colorOf(v);
                    const hovered = hover?.i === i && hover?.j === j;
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
                            highlightElement([
                              ...view.rows[i].ids,
                              ...view.cols[j].ids,
                            ]);
                          }}
                        >
                          <title>
                            {`∂(${view.rows[i].label}) / ∂(${view.cols[j].label}) = ${
                              v === undefined ? "0" : fixed(v, 3)
                            }`}
                          </title>
                        </rect>
                        {showNumbers && v !== undefined && (
                          <text
                            x={x + cell / 2}
                            y={y + cell / 2}
                            fontSize={8}
                            textAnchor="middle"
                            dominantBaseline="central"
                            pointerEvents="none"
                            fill={style.text}
                          >
                            {fixed(v, Math.abs(v) >= 100 ? 0 : 1)}
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
                  Hover a cell to inspect it; click a label to jump to it. Blank
                  cells are exactly zero — that measurement doesn't see that
                  state.
                </Text>
              )}
            </div>
            <Text size="xs" c="dimmed" mt={2}>
              {nRows} measurement{nRows === 1 ? "" : "s"} × {nCols} state
              {nCols === 1 ? "" : "s"}
              {focus
                ? ` that involve the focused bus (of ${fullRows}×${fullCols}).`
                : ". Linearized at the estimated state."}
            </Text>
          </>
        )}
      </>
    </ToolWindow>
  );
}
