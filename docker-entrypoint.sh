#!/bin/sh

# Ensure config directory exists
mkdir -p /app/config

# If config.json doesn't exist in the volume, copy the sample
if [ ! -f /app/config/config.json ]; then
    echo "No config.json found in volume, copying sample..."
    if [ -f /app/config.json.sample ]; then
        cp /app/config.json.sample /app/config/config.json
    else
        echo "Warning: No config.json.sample found, creating minimal config..."
        echo '{
    "username": "",
    "password": "",
    "interface": "0.0.0.0",
    "port": 2101,
    "mountPoint": "NEAR-Default",
    "userAgent": "NearTRIP/1.0",
    "adminPort": 3000,
    "adminUser": "admin",
    "adminPassword": "admin",
    "stations": []
}' > /app/config/config.json
    fi
fi

# Create symlink to maintain compatibility with existing code
ln -sf /app/config/config.json /app/config.json

# Start the application
exec "$@"
