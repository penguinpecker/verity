# Verity attestor — the witness that performs the TLS check and signs zkTLS proofs.
# Built from reclaimprotocol/attestor-core pinned to a known-good commit, run under
# our own signing key. Deploys as-is on Railway (Dockerfile builder).
FROM node:22-bookworm

# Native build deps for re2 (runtime regex engine) + git to fetch the pinned source.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pin the attestor implementation. Bump deliberately; do not float.
ARG ATTESTOR_COMMIT=67eade1f2436e071601fba00ef5e26917bab30c2
RUN git clone https://github.com/reclaimprotocol/attestor-core.git . \
  && git checkout ${ATTESTOR_COMMIT}

# Install without the package's own build step; compile native addons; fetch ZK circuits.
RUN npm install --ignore-scripts \
  && npm rebuild \
  && npm run download:zk-files

ENV NODE_ENV=production
# Railway injects PORT; PRIVATE_KEY must be set as a Railway variable (see .env.example).
# The server reads both from the environment directly.
EXPOSE 8001
CMD ["node", "--experimental-strip-types", "src/scripts/start-server.ts"]
