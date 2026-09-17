FROM node:20-slim AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN yarn build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production && yarn cache clean
COPY --from=build /app/dist ./dist

# Persist tokens.json outside the container filesystem. Mount a volume here
# and set TOKENS_PATH=/data/tokens.json.
VOLUME ["/data"]
ENV TOKENS_PATH=/data/tokens.json

EXPOSE 8080
CMD ["node", "dist/httpServer.js"]
