#!/bin/sh
set -e

PORT=${PORT:-8080}
BILLING_PORT=${BILLING_PORT:-8081}

echo "Starting Python EVV server on port $PORT..."
PORT=$PORT python3 backend/server.py &

echo "Starting billing server on port $BILLING_PORT..."
BILLING_PORT=$BILLING_PORT node billing/dist/index.js &

wait -n
