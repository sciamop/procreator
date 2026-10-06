#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
unit_file="$project_dir/systemd/procreate-archive.service"
service_name=procreate-archive.service

# Fail before changing anything if invoked without access to the user manager.
if ! systemctl --user show-environment >/dev/null; then
  echo "Run this installer from a regular terminal in your desktop session; the user systemd manager is not accessible here." >&2
  exit 1
fi

cd -- "$project_dir"
if [[ ! -d node_modules ]]; then npm ci; fi
npm run build
node scripts/render-service.mjs
readiness_url="$(node --input-type=module -e 'import { serverConfig } from "./scripts/server-config.mjs"; const {host,port}=serverConfig(); const address=host==="0.0.0.0"?"127.0.0.1":host==="::"?"::1":host; console.log(`http://${address.includes(":")?`[${address}]`:address}:${port}/`);')"
systemctl --user link "$unit_file"
systemctl --user daemon-reload
systemctl --user enable "$service_name"
systemctl --user restart "$service_name"

# Wait for the actual gallery, not just a briefly active process or another app.
for ((attempt = 0; attempt < 30; attempt++)); do
  if systemctl --user is-active --quiet "$service_name" &&
     curl --fail --silent --max-time 2 "$readiness_url" | grep -F 'Procreator' >/dev/null; then
    systemctl --user status "$service_name" --no-pager
    echo "Startup enabled. Gallery is responding at $readiness_url (use your server address from other devices)."
    exit 0
  fi
  sleep 1
done
echo "The service did not become ready at $readiness_url. Check the log and whether another server is using the configured port:" >&2
journalctl --user -u "$service_name" -n 30 --no-pager
exit 1
