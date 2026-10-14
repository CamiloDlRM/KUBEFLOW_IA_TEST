# Stage 1: Compilar MinIO desde la fuente oficial con Go
FROM golang:alpine AS builder

RUN apk add --no-cache git
ENV CGO_ENABLED=0

RUN go install github.com/minio/minio@latest

# Stage 2: Imagen final ligera para ejecución
FROM alpine:3.19

RUN apk add --no-cache curl ca-certificates

COPY --from=builder /go/bin/minio /usr/local/bin/minio

EXPOSE 9000 9001

ENTRYPOINT ["minio"]
