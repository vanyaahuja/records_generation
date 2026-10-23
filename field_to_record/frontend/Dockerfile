FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY frontend/package*.json ./
COPY deploy/npm-cache/ /npm-cache/
ARG OFFLINE_BUILD=0
RUN if [ "$OFFLINE_BUILD" = "1" ]; then npm ci --offline --cache=/npm-cache; else npm ci --cache=/npm-cache --prefer-offline; fi
COPY frontend/ ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz
