# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/uploads ./uploads

ENV NODE_ENV=production
EXPOSE 3000

# Sync database and seed on startup
CMD ["sh", "-c", "npx prisma db push --url=$DATABASE_URL && DATABASE_URL=$DATABASE_URL npx tsx prisma/seed.ts && node dist/main.js"]