# One image: the frontend's static build, served by the backend with the API, the same way
# the desktop app runs. Open http://localhost:8000.

FROM node:20-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app/ ./app/
COPY --from=frontend /frontend/out /frontend

ENV PYTHONUNBUFFERED=1
ENV DOUBLESHIFT_FRONTEND_DIR=/frontend

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
