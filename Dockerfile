FROM node:22-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Bundle app source and set ownership to non-root node user
COPY --chown=node:node . .
RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app/data

USER node

# Start the bot
CMD [ "node", "index.js" ]
