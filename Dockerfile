FROM python:3.12-slim

WORKDIR /app

# Install Node.js for frontend build
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY . .

# Build the frontend
RUN npm install --registry https://registry.npmjs.org/ && npm run build

RUN mkdir -p /app/data

EXPOSE 8080

CMD ["python3", "backend/server.py"]
