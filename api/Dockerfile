# The homecookd api. Built from api/ by .github/workflows/deploy-aws.yml.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# RDS's certificate authorities, so the database connection is checked, not only encrypted.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem
RUN chmod 644 /app/rds-ca.pem
ENV NODE_EXTRA_CA_CERTS=/app/rds-ca.pem
# The load balancer's check, on its own thread (src/health.ts). In the image, not only in Terraform, so an image can roll out before the check moves to it.
# The task definition sets the same port from the api's health_port (infra/envs/*/main.tf), and a test keeps the two equal.
ENV HEALTH_PORT=8081
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY package.json ./
USER node
CMD ["node", "--import", "./dist/sentry.js", "dist/index.js"]
