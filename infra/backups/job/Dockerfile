# Copies one full Convex export, with stored files, to S3. Run daily by infra/backups.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends awscli ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json backup.sh ./
RUN npm ci
USER node
ENTRYPOINT ["bash", "/app/backup.sh"]
