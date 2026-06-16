# Power Grid Editor SVG Library

Editable monochrome SVG symbol pack for UI editors covering pandapower elements and CGMES/CIM equipment concepts.

## Scope

- `symbols/pandapower/`: pandapower element-facing icons.
- `symbols/cgmes/`: CGMES/CIM class-facing icons.
- `symbols/common/`: neutral symbols that both mappings can point to.
- `mappings/pandapower-symbol-map.json`: pandapower table/element name -> SVG.
- `mappings/cgmes-symbol-map.json`: CGMES/CIM class -> SVG.
- `mappings/pandapower-to-cgmes-hints.json`: approximate semantic crosswalk for editor import/export.
- `stencils/pandapower-mxlibrary.json`: starter diagrams.net/mxGraph library payload.

## Design conventions

- All SVGs are 120x80 viewBox, standalone, editable, and use `currentColor`.
- No embedded fonts, raster images, external CSS, or proprietary assets.
- These are UI-editor glyphs, not certified IEC 60617 drawings. Use them as design-system components and map them to real data classes via the JSON files.

## Coverage focus

Pandapower: bus, line, transformer, 3-winding transformer, switch, load, asymmetric load/source, static generator, generator, external grid, storage, motor, shunt, ward/xward, impedance, DC line/bus/source/load, VSC, SVC, SSC, TCSC, measurements, costs, controller, groups.

CGMES/CIM: substations, voltage levels, bays, terminals, connectivity/topological nodes, busbars, AC/DC lines, transformers, switches, breakers/disconnectors/fuses, loads, synchronous machines, generating units, external/equivalent injections, shunts, SVC/series compensation, grounding, power electronics, solar/wind/hydro/thermal/battery units, tap changers, instrument transformers, measurements, operational limits, and diagram objects.

## Suggested editor model

Keep symbols separate from data. A node/edge in your editor should have:

```json
{
  "id": "uuid",
  "sourceSchema": "pandapower|cgmes",
  "class": "ACLineSegment|line|PowerTransformer|trafo",
  "symbol": "symbols/common/ac-line-segment.svg",
  "terminals": [],
  "attributes": {}
}
```
