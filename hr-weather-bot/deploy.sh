#!/usr/bin/env sh
# One-line deploy: build, replace any existing container, run detached.
docker build -t hr-weather-bot . && (docker rm -f hr-weather-bot >/dev/null 2>&1 || true) && docker run -d --name hr-weather-bot --restart unless-stopped --env-file .env -v hr-weather-data:/app/data hr-weather-bot
