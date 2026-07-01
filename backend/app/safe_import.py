"""Reject code-execution payloads in an uploaded pandapower JSON *before* it
reaches ``pp.from_json_string``.

pandapower's JSON loader is a deserializer: any object of the form
``{"_module": ..., "_class": ..., "_object": ...}`` makes it
``importlib.import_module(module)`` then call ``getattr(module, class)(object)``
(see ``pandapower/io_utils.py`` ``pp_hook`` -> ``FromSerializableRegistry.rest``).
On untrusted input that is arbitrary code execution — e.g.
``{"_module": "os", "_class": "system", "_object": "<cmd>"}`` runs a shell
command *while parsing*, before any downstream type check can help.

Legitimate pandapower exports only reference a small set of data classes. This
validator does a plain, side-effect-free ``json.loads`` (no object hook, so
nothing is constructed) and walks the structure, allowing only that known-good
set of ``(_module, _class)`` pairs and rejecting everything else. It also
descends into embedded JSON strings, because the loader re-parses a nested
pandapowerNet's ``_object`` string through the same dangerous hook.
"""

from __future__ import annotations

import json

# (_module, _class) pairs a real pandapower/editor export legitimately contains.
# Each maps to a dedicated, safe deserializer in io_utils; anything outside this
# set falls through to the generic import-and-call gadget, so it is refused.
_ALLOWED_PAIRS: frozenset[tuple[str, str]] = frozenset(
    {
        ("pandapower.auxiliary", "pandapowerNet"),
        ("pandas.core.frame", "DataFrame"),
        ("pandas.core.series", "Series"),
        ("networkx", "MultiGraph"),
        ("networkx.classes.multigraph", "MultiGraph"),
        ("geopandas.geodataframe", "GeoDataFrame"),
    }
)

# numpy scalars/arrays serialize as ``_module: "numpy"``. Only data classes are
# allowed — never callables like ``numpy.load`` (which unpickles → RCE).
_ALLOWED_NUMPY_CLASSES: frozenset[str] = frozenset(
    {
        "array", "ndarray", "matrix",
        "bool", "bool_",
        "int8", "int16", "int32", "int64",
        "uint8", "uint16", "uint32", "uint64",
        "intc", "intp", "uintc", "uintp",
        "float16", "float32", "float64", "float128", "longdouble",
        "complex64", "complex128",
        "str_", "bytes_", "datetime64", "timedelta64",
    }
)

# Bound on how deep / how many nodes we walk, so a pathologically nested or huge
# document can't turn validation itself into a DoS. The import byte cap already
# bounds total size; this bounds structural blow-up.
_MAX_NODES = 5_000_000


class UnsafeImportError(ValueError):
    """The uploaded JSON references a module/class outside the allowlist — i.e.
    it could drive pandapower's loader into arbitrary code execution."""


def _pair_allowed(module: str, cls: str) -> bool:
    if (module, cls) in _ALLOWED_PAIRS:
        return True
    if module == "numpy" and cls in _ALLOWED_NUMPY_CLASSES:
        return True
    return False


def validate_import_json(raw: str) -> None:
    """Raise :class:`UnsafeImportError` if ``raw`` contains any deserialization
    directive outside the allowlist. Returns ``None`` when the document is safe
    to hand to ``pp.from_json_string``.

    Does not validate that the document *is* a pandapower net — only that parsing
    it can't execute code. Plain-JSON parse errors are left for pandapower to
    report (as a 400) downstream.
    """
    try:
        root = json.loads(raw)
    except (ValueError, RecursionError):
        # Not parseable as plain JSON → it can't be a valid pandapower net either;
        # let from_json_string produce the user-facing parse error.
        return

    # Iterative walk (an explicit stack, so deeply nested input can't blow the
    # Python recursion limit). Strings that look like embedded JSON are re-parsed
    # and walked too, matching the loader's nested-net re-parse.
    stack = [root]
    seen = 0
    while stack:
        node = stack.pop()
        seen += 1
        if seen > _MAX_NODES:
            raise UnsafeImportError("Import structure is too large to validate.")
        if isinstance(node, dict):
            if "_module" in node and "_class" in node:
                module = node.get("_module")
                cls = node.get("_class")
                if not isinstance(module, str) or not isinstance(cls, str) or not _pair_allowed(module, cls):
                    raise UnsafeImportError(
                        f"Refusing import: disallowed object reference "
                        f"{module!r}.{cls!r}."
                    )
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
        elif isinstance(node, str) and "_module" in node:
            # A nested pandapowerNet stores its inner document as a JSON string
            # that the loader re-parses through the same hook — so peek inside.
            try:
                stack.append(json.loads(node))
            except (ValueError, RecursionError):
                pass
