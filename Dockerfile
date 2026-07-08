FROM node:20-slim

# Install git dan dependencies lain yang diperlukan
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN node seed.js

EXPOSE 3000
CMD ["node", "index.js"]
