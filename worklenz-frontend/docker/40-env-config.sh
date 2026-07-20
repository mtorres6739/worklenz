#!/bin/sh
set -eu

cat > /usr/share/nginx/html/env-config.js <<EOF
window.VITE_API_URL = "${VITE_API_URL:-}";
window.VITE_SOCKET_URL = "${VITE_SOCKET_URL:-}";
window.VITE_CLIENT_PORTAL_URL = "${VITE_CLIENT_PORTAL_URL:-}";
EOF
