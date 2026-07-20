FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

ARG VITE_EDITION=ce
ARG VITE_ALLOW_SIGNUPS=false
ENV VITE_EDITION=${VITE_EDITION}
ENV VITE_ALLOW_SIGNUPS=${VITE_ALLOW_SIGNUPS}
ENV SENTRY_UPLOAD_SOURCEMAPS=false
RUN NODE_OPTIONS="--max-old-space-size=4096" npm run build

FROM nginx:1.27-alpine AS production
COPY docker/default.conf /etc/nginx/conf.d/default.conf
COPY docker/40-env-config.sh /docker-entrypoint.d/40-env-config.sh
COPY --from=build /app/build /usr/share/nginx/html
RUN chmod 755 /docker-entrypoint.d/40-env-config.sh
EXPOSE 8080
