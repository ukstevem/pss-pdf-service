#!/usr/bin/env bash
set -euo pipefail

REGISTRY="ghcr.io/ukstevem/pss-pdf-service"
PLATFORM="linux/arm64"

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"

docker buildx inspect multiarch >/dev/null 2>&1 || \
  docker buildx create --name multiarch --use
docker buildx use multiarch

docker buildx build \
  --platform "$PLATFORM" \
  -t "$REGISTRY:$SHA" \
  -t "$REGISTRY:latest" \
  --push \
  .

echo "Pushed $REGISTRY:$SHA and $REGISTRY:latest"
