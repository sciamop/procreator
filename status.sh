#!/usr/bin/env bash
set -euo pipefail
exec systemctl --user status procreate-archive.service --no-pager
