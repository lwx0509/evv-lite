FROM node:20-slim AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim AS billing-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY billing/ ./billing/
RUN ./node_modules/.bin/tsc -p billing/tsconfig.json

FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY --from=frontend-builder /app/dist ./dist
COPY --from=billing-builder /app/billing/dist ./billing/dist
COPY --from=billing-builder /app/node_modules ./node_modules
COPY backend/ ./backend/
COPY start.sh ./start.sh
RUN chmod +x start.sh && mkdir -p /app/data

EXPOSE 8080
CMD ["./start.sh"]
