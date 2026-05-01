# Fase dummy (DUMMY_MODE=true): python:3.11-slim es suficiente.
# Cuando el modelo real esté listo, cambia la base por:
#   nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04
# y ajusta PATH para que use el Python del sistema.
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=120 -r requirements.txt

COPY celery_app.py tasks.py main.py gunicorn.conf.py config_classes.py ./

# Directorio compartido con el worker (sobreescrito por el volumen en producción)
RUN mkdir -p /app/uploads

# Default: API con Gunicorn+Uvicorn workers (el worker ML sobreescribe en docker-compose)
CMD ["gunicorn", "main:app", "-c", "gunicorn.conf.py"]
