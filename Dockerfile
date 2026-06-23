# build v2
FROM node:20-slim AS billing-builder
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev
COPY billing/ ./billing/
RUN npx --yes --package typescript tsc -p billing/tsconfig.json

FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY --from=billing-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=billing-builder /usr/local/include/node /usr/local/include/node
COPY --from=billing-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm

COPY dist/ ./dist/
COPY --from=billing-builder /app/billing/dist ./billing/dist
COPY --from=billing-builder /app/node_modules ./node_modules
COPY backend/ ./backend/
COPY start.sh ./start.sh
RUN chmod +x start.sh && mkdir -p /app/data

EXPOSE 8080
CMD ["bash", "start.sh"]
