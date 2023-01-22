FROM node:18
ENV NODE_ENV=production
WORKDIR /app
COPY ["package.json", "package-lock.json*", "./"]
RUN npm install --production
COPY config config
COPY index.js index.js

CMD [ "node", "index.js" ]