FROM python:3.12-slim

LABEL org.opencontainers.image.source="https://github.com/JUNO-care/Vibecode-MVP-V1"
LABEL org.opencontainers.image.description="Juno v2 — Midwife Route Planner"

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

RUN adduser --disabled-password --no-create-home appuser

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /data && chown appuser:appuser /data
VOLUME /data

ENV DB_PATH=/data/juno.db
ENV JUNO_SECRET_KEY=change-me-in-production

EXPOSE 5002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5002/ || exit 1

USER appuser

CMD ["gunicorn", "-b", "0.0.0.0:5002", "-w", "1", "tools.server:app"]
