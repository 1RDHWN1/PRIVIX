#!/usr/bin/env bash
set -euo pipefail

echo "== coturn service =="
sudo systemctl status coturn --no-pager || true

echo ""
echo "== listening UDP/TCP 3478 =="
sudo ss -lunp | grep -E ':3478' || true
sudo ss -ltnp | grep -E ':3478' || true

echo ""
echo "== recent coturn logs (last 100 lines) =="
sudo journalctl -u coturn -n 100 --no-pager || true
