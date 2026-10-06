#!/usr/bin/env bash
set -euo pipefail
exec systemctl --user restart procreate-archive.service
