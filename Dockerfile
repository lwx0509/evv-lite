FROM node:20-slim AS frontend-builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY --from=frontend-builder /app/dist ./dist
COPY backend/ ./backend/
RUN mkdir -p /app/data
EXPOSE 8080
CMD ["python3", "backend/server.py"]
