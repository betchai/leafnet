# LEAFNET ML inference service — Production
# FastAPI + PyTorch CPU (MobileNetV2 transfer learning).
# Platform locked to linux/amd64: PyTorch CPU wheels are x86_64-only.
FROM --platform=linux/amd64 python:3.12-slim

WORKDIR /app

# System deps for opencv-python-headless
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

# Python deps (cached layer)
COPY docker/requirements-prod.txt .
RUN pip install --no-cache-dir -r requirements-prod.txt

# Application source
COPY ml/src ./src
COPY ml/models ./models
COPY ml/data ./data

ENV ML_PORT=8000
EXPOSE 8000

CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
