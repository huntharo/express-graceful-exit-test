FROM node:10-alpine
WORKDIR /app
COPY . /app

RUN npm install && npm add express-graceful-exit

CMD [ "node", "index.js" ]
