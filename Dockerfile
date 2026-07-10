# Dockerfile — recipe to package the JasJus server into a runnable image.

# 1. Base image: Node 22 on slim Debian. "slim" = small but glibc-based, so
#    better-sqlite3's prebuilt binary works without compiling from source.
FROM node:22-slim

# 2. Where our app lives inside the container.
WORKDIR /app

# 3. Copy ONLY the manifests first, then install. Docker caches this layer, so
#    dependencies are re-installed only when package.json changes — not on every
#    code edit. Faster rebuilds.
COPY package*.json ./
RUN npm install --omit=dev

# 4. Copy the rest of the source (server.js, db.js, etc.).
#    .dockerignore keeps node_modules, .env and the local db out of this copy.
COPY . .

# 5. Document the port the app listens on.
EXPOSE 3000

# 6. The command that runs when the container starts.
CMD ["node", "server.js"]