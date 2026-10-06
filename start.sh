#!/usr/bin/env bash
set -euo pipefail
exec systemctl --user start procreate-archive.service
