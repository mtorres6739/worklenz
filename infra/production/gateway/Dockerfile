FROM nginx:1.27-alpine
RUN apk upgrade --no-cache
COPY infra/production/nginx.conf /etc/nginx/nginx.conf
COPY infra/production/cloudflare-realip.conf /etc/nginx/cloudflare-realip.conf
