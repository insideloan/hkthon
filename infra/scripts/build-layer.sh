#!/usr/bin/env bash
# Build the orchestrator runtime-dependency Lambda layer (#83 block 5 / #50).
#
# WHY this exists: the layer dir (infra/layers/orchestrator-deps/, ~110MB) is
# gitignored, so every build environment must regenerate it before `cdk synth`
# /`cdk deploy`. CDK's PythonFunction (Docker bundling) isn't usable here — no
# Docker in this environment — so we cross-download x86_64-manylinux wheels with
# uv to match the x86_64 Lambda runtime.
#
# Usage:  bash infra/scripts/build-layer.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # infra/
DEST="$ROOT/layers/orchestrator-deps/python"
REQ_RUNTIME=(pydantic langchain langgraph langchain-aws httpx amazon-transcribe)
# boto3/botocore: provided by the Lambda runtime — do NOT bundle.
# amazon-transcribe: STT bridge (AGENT-008) is now wired (live mode). It only
#   pulls awscrt (~26MB total, no numpy) → layer ~110MB→136MB, well under the
#   250MB unzipped limit. Required at runtime by stt/transcribe_stt.py.

echo "[build-layer] target: $DEST"
rm -rf "$ROOT/layers/orchestrator-deps"
mkdir -p "$DEST"

# Cross-platform: x86_64 manylinux wheels for Python 3.13, binary-only so no
# host compiler / arch leakage (this host is aarch64; Lambda is x86_64).
uv pip install --target "$DEST" \
  --python-platform x86_64-manylinux2014 --python-version 3.13 \
  --only-binary :all: \
  "${REQ_RUNTIME[@]}"

# Trim runtime-provided SDKs if they came in transitively.
rm -rf "$DEST"/boto3 "$DEST"/boto3-* "$DEST"/botocore "$DEST"/botocore-*

echo "[build-layer] done — size: $(du -sh "$DEST" | cut -f1)"
echo "[build-layer] verify x86_64:"
find "$DEST" -name '*.so' | head -1 | xargs -r file | grep -o 'x86-64' || echo "  (no .so found)"
