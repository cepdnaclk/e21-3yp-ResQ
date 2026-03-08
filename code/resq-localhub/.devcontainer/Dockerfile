FROM node:20-bookworm

RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    openssh-client \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /workspace