FROM node:20-slim
WORKDIR /app
RUN apt-get update && apt-get install -y git python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
COPY . .
RUN node seed.js
EXPOSE 3000
CMD ["node", "index.js"]
