FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY prisma ./prisma/
RUN npx prisma generate

COPY src ./src/

EXPOSE 3000

CMD ["node", "src/index.js"]
