# Use the highly optimized Alpine Linux build for Node.js
FROM node:18-alpine

# Set the environment to production for optimal performance
ENV NODE_ENV=production

# Create the app directory and give the node user ownership so it can write .tmp files
RUN mkdir -p /usr/src/app && chown -R node:node /usr/src/app
WORKDIR /usr/src/app

# Copy package files first to leverage Docker layer caching
COPY package*.json ./

# Perform a clean, production-only install
RUN npm ci --omit=dev

COPY . .

CMD [ "node", "index.js" ]