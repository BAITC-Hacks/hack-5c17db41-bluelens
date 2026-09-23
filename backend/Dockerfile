FROM python:3.12-slim
WORKDIR /workspace
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY app /workspace/backend/app
ENV DATABASE_PATH=/app/data/ekt_assistant.sqlite3
EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
