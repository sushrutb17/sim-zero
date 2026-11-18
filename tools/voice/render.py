"""Render voice jobs to WAV files with Kokoro, offline.

Usage (isolated mode, from the repo root):
    tools/voice/.venv/bin/python -I tools/voice/render.py <jobs.json> <modelsDir> <outDir>

jobs.json is a list of {id, text, voice, speed, lang}. It is read as data only: every field is
validated before use, and nothing here builds a shell command. Only the job id is ever printed,
never the text. Exit codes: 0 all rendered, 1 at least one job failed, 2 bad arguments or job file.
"""
import json
import re
import sys
from pathlib import Path

ID_RE = re.compile(r"[A-Za-z0-9_-]+")
VOICE_RE = re.compile(r"[ab][fm]_[a-z]+")
LANGS = {"en-us", "en-gb"}


def validate(job):
    if not isinstance(job, dict):
        raise ValueError("job is not an object")
    jid, text, voice, speed, lang = (job.get(k) for k in ("id", "text", "voice", "speed", "lang"))
    if not isinstance(jid, str) or not ID_RE.fullmatch(jid):
        raise ValueError("bad id")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("bad text")
    if not isinstance(voice, str) or not VOICE_RE.fullmatch(voice):
        raise ValueError("bad voice")
    if isinstance(speed, bool) or not isinstance(speed, (int, float)) or not 0.5 <= speed <= 2.0:
        raise ValueError("bad speed")
    if lang not in LANGS:
        raise ValueError("bad lang")
    return jid, text, voice, float(speed), lang


def main(argv):
    if len(argv) != 4:
        print("usage: render.py <jobs.json> <modelsDir> <outDir>", file=sys.stderr)
        return 2
    jobs_path, models, out = Path(argv[1]), Path(argv[2]), Path(argv[3])
    try:
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
        if not isinstance(jobs, list):
            raise ValueError("jobs file is not a list")
        parsed = []
        for index, job in enumerate(jobs):
            try:
                parsed.append(validate(job))
            except ValueError as error:
                raise ValueError(f"job {index}: {error}") from None
    except (OSError, ValueError) as error:
        print(f"Invalid jobs file: {error}", file=sys.stderr)
        return 2
    ids = [p[0] for p in parsed]
    if len(set(ids)) != len(ids):
        print("Invalid jobs file: duplicate id", file=sys.stderr)
        return 2

    import soundfile as sf
    from kokoro_onnx import Kokoro

    out.mkdir(parents=True, exist_ok=True)
    kokoro = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
    failed = 0
    for jid, text, voice, speed, lang in parsed:
        try:
            samples, rate = kokoro.create(text, voice=voice, speed=speed, lang=lang)
            sf.write(out / f"{jid}.wav", samples, rate)
            print(f"ok {jid} {len(samples) / rate:.2f}s", flush=True)
        except Exception as error:  # report the id and error type only, never the text
            failed += 1
            print(f"FAIL {jid} ({type(error).__name__})", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
