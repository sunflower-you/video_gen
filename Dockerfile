FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN adduser --disabled-password --gecos "" appuser

COPY pyproject.toml README.md ./
COPY app ./app
COPY workflows ./workflows
COPY comfyui_plugin ./comfyui_plugin
COPY frontend ./frontend

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -e ".[queue,postgres]"

USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.backend.api:app", "--host", "0.0.0.0", "--port", "8000"]
