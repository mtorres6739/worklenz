ARG POSTGRES_BASE_IMAGE=postgres:15-alpine
FROM ${POSTGRES_BASE_IMAGE}

COPY worklenz-backend/database/00_init.sh /docker-entrypoint-initdb.d/00_init.sh
COPY worklenz-backend/database/sql /docker-entrypoint-initdb.d/sql
RUN chmod 755 /docker-entrypoint-initdb.d/00_init.sh
