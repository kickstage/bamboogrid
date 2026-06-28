"""OpenTelemetry tracing.

Opt-in: a real exporter and HTTP instrumentation are configured only when
``OTEL_EXPORTER_OTLP_ENDPOINT`` is set. Without it the module-level ``tracer``
falls back to the no-op provider, so the manual spans sprinkled through the API
cost almost nothing and local dev / tests stay quiet (no failed exports).

Endpoint and service name follow the standard ``OTEL_*`` environment variables.
"""

from __future__ import annotations

import os

from opentelemetry import trace

tracer = trace.get_tracer("bamboogrid.app")

_configured = False


def setup_tracing(app) -> None:
    """Configure the OTLP exporter and instrument the FastAPI app. No-op unless
    ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set, or if called more than once."""
    global _configured
    if _configured or not os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return

    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    service_name = os.getenv("OTEL_SERVICE_NAME", "bamboogrid-backend")
    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app)
    _configured = True
