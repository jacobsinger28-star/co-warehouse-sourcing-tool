# ── Stage 1: Build React frontend ────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Official Playwright image — Chromium pre-installed ───
# Avoids all apt-get/font-package issues on non-Ubuntu distros.
FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Copy the built React app into a 'static' folder FastAPI will serve
COPY --from=frontend-build /app/frontend/dist ./static

EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
