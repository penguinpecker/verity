# Verity prover backend — runs @verity/sdk (native zkTLS prover) and streams proofs.
# The static frontend lives on Vercel and calls this over CORS; this also serves the
# frontend itself as a fallback. Deploys on Railway (Dockerfile builder).
FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Clone the public repo (contains packages/sdk + apps/demo).
ARG VERITY_REF=main
RUN git clone --depth 1 --branch ${VERITY_REF} https://github.com/penguinpecker/verity.git .

# SDK deps (build native re2), then demo deps.
RUN cd packages/sdk && npm install --ignore-scripts && npm rebuild
RUN cd apps/demo && npm install

ENV NODE_ENV=production
EXPOSE 4000
WORKDIR /app/apps/demo
CMD ["node", "server.js"]
