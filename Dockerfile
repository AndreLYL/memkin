# Dockerfile for the Glama MCP registry (https://glama.ai/mcp/servers).
#
# memkin ships as an npm package; its MCP server runs over stdio via
# `memkin serve --mcp`. Glama builds this image and speaks MCP over stdio to
# introspect the server's tools, so the container just needs memkin installed
# plus a minimal config the server can boot from (PGLite store, no external
# API keys required to start and list tools).
#
# Run locally:
#   docker build -t memkin-mcp .
#   docker run --rm -i memkin-mcp   # then speak MCP JSON-RPC over stdin/stdout

FROM node:22-slim

# Install the published memkin CLI globally.
RUN npm install -g memkin@latest

# Minimal config so the stdio MCP server can boot in a fresh container.
# PGLite is embedded (no external database); LLM/embedding keys are only needed
# for extraction/semantic search, not for starting the server or listing tools.
WORKDIR /app
RUN printf 'store:\n  engine: pglite\n  data_dir: /app/data\nsources:\n  claude-code:\n    enabled: true\n' > /app/memkin.yaml \
    && mkdir -p /app/data

# Glama communicates with the server over stdio.
ENTRYPOINT ["memkin", "serve", "--mcp", "--config", "/app/memkin.yaml"]
