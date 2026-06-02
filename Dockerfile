FROM node:22-alpine

WORKDIR /home/node/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3065
CMD ["npm", "run", "dev"]
