# Reproducible multi-stage build of the pitlane server (client embedded).
#   docker buildx build --platform linux/arm64 --build-arg VERSION=$(git describe --always --dirty) -t pitlane:dev .
# Production deploys use Dockerfile.runtime with a binary from scripts/release.sh.

# node:22-alpine = node 22.23.3 (multi-arch index digest, re-checked current 2026-10-06)
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS client
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN mkdir -p ../cmd/pitlane/web && npm run build

# golang:1.26.8-alpine (multi-arch index digest, re-checked current 2026-10-06). Its
# GOTOOLCHAIN=local ignores go.mod's toolchain line: keep this image >= that toolchain.
FROM golang:1.26.8-alpine@sha256:8ac98ca534ac3f51e1f420a1dd2c15e74c75cfa0f23f3ad27eb5d7236c349a0c AS server
ARG VERSION=dev
ARG TARGETOS=linux
ARG TARGETARCH=arm64
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
COPY --from=client /src/cmd/pitlane/web/ cmd/pitlane/web/
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o /out/pitlane ./cmd/pitlane

# gcr.io/distroless/static-debian12:nonroot (multi-arch index digest, re-checked current 2026-10-06)
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab
COPY --from=server /out/pitlane /pitlane
# /data owned by the runtime user (mode 0755; the server chmods it 0700 at start); a fresh
# named volume copies this ownership on first mount.
COPY --from=gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab --chown=65532:65532 /home/nonroot /data
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/pitlane"]
