FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY prisma ./prisma
RUN npm install --omit=dev && npx prisma generate

COPY . .
RUN npx prisma generate

EXPOSE 8080

CMD ["node", "cmd/server/main.js"]
