#!/bin/bash

PORT=${PORT:-8080}
BILLING_PORT=${BILLING_PORT:-8081}

echo "Starting billing server on port $BILLING_PORT..."
BILLING_PORT=$BILLING_PORT node billing/dist/index.js &

echo "Starting Python EVV server on port $PORT..."
exec python3 backend/server.py
