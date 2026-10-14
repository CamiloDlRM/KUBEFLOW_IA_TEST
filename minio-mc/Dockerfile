# Stage 1: Compilar MinIO Client (mc) desde la fuente oficial con Go
FROM golang:alpine AS builder

RUN apk add --no-cache git
ENV CGO_ENABLED=0

RUN go install github.com/minio/mc@latest

# Stage 2: Imagen final ligera para ejecución
FROM alpine:3.19

RUN apk add --no-cache curl ca-certificates

COPY --from=builder /go/bin/mc /usr/local/bin/mc

ENTRYPOINT ["mc"]
