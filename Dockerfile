FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY ..

ARG VITE_TELEGRAM_SHOP_URL
ARG VITE_TELEGRAM_BOT_URL

ENV VITE_TELEGRAM_SHOP_URL=$VITE_TELEGRAM_SHOP_URL
ENV VITE_TELEGRAM_BOT_URL=$VITE_TELEGRAM_BOT_URL

RUN npm run build

FROM NODE_ENV=production
ENV PORT=8787

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/data ./data
COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/uploads \
    && chown -R node:node /app

USER node

EXPOSE 8787

CMD ["node", "server/index.js"]