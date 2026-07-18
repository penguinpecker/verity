# Verity remote-browser proving service.
# Hosts a real Chromium the user drives to log into a real source; witnesses the
# authenticated response through the attestor; records a yes/no predicate on-chain.
FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG VERITY_REF=main
# Bust the Docker layer cache whenever `main` moves (byte-identical clone else caches).
ADD https://api.github.com/repos/penguinpecker/verity/commits/${VERITY_REF} /tmp/verity-head.json
RUN git clone --depth 1 --branch ${VERITY_REF} https://github.com/penguinpecker/verity.git .

# SDK deps (native re2 for the zkTLS prover), then service deps.
RUN cd packages/sdk && npm install --ignore-scripts && npm rebuild
RUN cd services/remote-browser && npm install

# Chromium + all system libraries Playwright needs.
RUN cd services/remote-browser && npx playwright install --with-deps chromium

ENV NODE_ENV=production
EXPOSE 4100
WORKDIR /app/services/remote-browser
CMD ["node", "server.js"]
