FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production \
    PORT=3000 \
    SQLITE_PATH=/data/paper-desk.db
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
