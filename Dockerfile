# build v2
FROM node:20-slim AS billing-builder
WORKDIR /app
COPY package*.json ./
RUN npm install --include=dev
RUN rm -rf node_modules && npm install --include=dev
RUN npm install -g typescript@5
COPY billing/ ./billing/
RUN tsc -p billing/tsconfig.json || true

FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY --from=billing-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=billing-builder /usr/local/include/node /usr/local/include/node
COPY --from=billing-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm

COPY --from=billing-builder /app/node_modules ./node_modules_frontend
COPY src/ ./src/
COPY public/ ./public/
COPY index.html ./index.html
COPY vite.config.ts ./vite.config.ts
COPY tailwind.config.js ./tailwind.config.js
COPY postcss.config.js ./postcss.config.js
COPY tsconfig.json ./tsconfig.json
COPY package.json ./package.json
RUN node node_modules_frontend/.bin/vite build --outDir dist
COPY --from=billing-builder /app/billing/dist ./billing/dist
COPY --from=billing-builder /app/node_modules ./node_modules
COPY backend/ ./backend/
COPY start.sh ./start.sh
RUN chmod +x start.sh && mkdir -p /app/data

EXPOSE 8080
CMD ["bash", "start.sh"]
