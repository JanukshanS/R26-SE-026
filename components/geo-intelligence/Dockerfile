# Geo-Intelligence API — FastAPI + Uvicorn on port 5001
# Build from components/geo-intelligence so src/ and data/ are in context.

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# curl for compose healthcheck (slim image has no curl by default — install minimal)
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY data/ ./data/

EXPOSE 5001

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD curl -f http://localhost:5001/v1/health || exit 1

CMD ["uvicorn", "src.api:app", "--host", "0.0.0.0", "--port", "5001"]
