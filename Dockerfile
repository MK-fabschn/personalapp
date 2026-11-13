FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY package.json ./
USER node
EXPOSE 3000
# Direkt mit node statt "npm start": npm will in ein Cache-Verzeichnis schreiben,
# das Dateisystem des Containers ist aber read-only.
CMD ["sh", "-c", "node scripts/migrate.js && exec node build"]
