FROM oven/bun:1-slim
WORKDIR /app
RUN apt-get update
RUN apt-get install -y build-essential python3
COPY bun.lockb .
COPY package.json .
RUN bun install --frozen-lockfile
COPY . .
CMD ["bun", "index.ts"]