FROM node:22

WORKDIR /app

COPY backend/package*.json ./

RUN npm ci

COPY backend/ ./

EXPOSE 8080

CMD ["node", "server.js"]
