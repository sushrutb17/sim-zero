#!/usr/bin/env bash
# One-time (idempotent) setup for the offline voice generator.
# Creates tools/voice/.venv (Python 3.12 via uv) and downloads the Kokoro model files when missing.
# Network is used only by uv/pip and for the model download. Nothing from the scenario is sent anywhere.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HERE/.venv"
MODELS="$HERE/models"
BASE_URL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
# Keep in step with MODEL_FILES in tools/voice-jobs.mjs.
FILES=(
  "kokoro-v1.0.onnx:7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5"
  "voices-v1.0.bin:bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"
)

command -v uv >/dev/null || { echo "uv is required (https://docs.astral.sh/uv/)." >&2; exit 1; }

if [ -x "$VENV/bin/python" ]; then
  echo "Python environment already exists: $VENV"
else
  uv venv --python 3.12 "$VENV"
  echo "Created Python 3.12 environment: $VENV"
fi
uv pip install --python "$VENV/bin/python" "kokoro-onnx==0.6.1" soundfile
echo "Python packages installed (kokoro-onnx==0.6.1, soundfile)."

mkdir -p "$MODELS"
for entry in "${FILES[@]}"; do
  name="${entry%%:*}"
  want="${entry##*:}"
  if [ -s "$MODELS/$name" ]; then
    echo "Model file present, not downloading: $name"
  else
    echo "Downloading $name"
    curl --fail --location --silent --show-error --output "$MODELS/$name.part" "$BASE_URL/$name"
    mv "$MODELS/$name.part" "$MODELS/$name"
  fi
  got="$(shasum -a 256 "$MODELS/$name" | awk '{print $1}')"
  if [ "$got" != "$want" ]; then
    echo "sha256 MISMATCH for $name (expected $want, got $got). Delete it and rerun." >&2
    exit 1
  fi
  echo "sha256 verified: $name"
done
echo "Voice generator ready."
