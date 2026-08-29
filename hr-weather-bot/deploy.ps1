# One-line deploy (PowerShell): build, replace any existing container, run detached.
docker build -t hr-weather-bot . ; if ($LASTEXITCODE -eq 0) { docker rm -f hr-weather-bot 2>$null; docker run -d --name hr-weather-bot --restart unless-stopped --env-file .env -v hr-weather-data:/app/data hr-weather-bot }
