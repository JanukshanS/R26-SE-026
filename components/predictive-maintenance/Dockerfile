# Predictive Maintenance API — FastAPI + Uvicorn on port 5000
# Build from components/predictive-maintenance so models/ and app/ are in context.

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

RUN mkdir -p data models

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000"]
