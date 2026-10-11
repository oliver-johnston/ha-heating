FROM node:22-alpine AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-alpine

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="app" \
    io.hass.arch="${BUILD_ARCH}"

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY --from=frontend /build/dist/ ./src/heat_steward/static/
COPY run.sh ./run.sh
RUN chmod a+x ./run.sh

ENV PYTHONPATH=/app/src \
    PYTHONUNBUFFERED=1

CMD ["/app/run.sh"]
