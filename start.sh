#!/bin/bash
set -e

PORT=${PORT:-8080}
BILLING_PORT=${BILLING_PORT:-8081}

echo "Building frontend..."
npm run build

echo "Compiling billing server..."
./node_modules/.bin/tsc -p billing/tsconfig.json

echo "Starting Python EVV server on port $PORT..."
PORT=$PORT python3 backend/server.py &

echo "Starting billing server on port $BILLING_PORT..."
BILLING_PORT=$BILLING_PORT node billing/dist/index.js &

wait
