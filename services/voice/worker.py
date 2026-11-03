"""Local-only ASR worker. Model acquisition is a separate explicit command.

stdout is a single transcript JSON document. Diagnostics go to stderr.
faster-whisper does not identify speakers; unknown is represented as null.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys


def audio_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def transcribe(args):
    # Set before importing model libraries. Processing must work offline.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["DO_NOT_TRACK"] = "1"
    model_dir = Path(args.model_dir).resolve(strict=True)
    audio = Path(args.audio).resolve(strict=True)
    if not model_dir.is_dir() or not (model_dir / "model.bin").is_file():
        raise ValueError("Expected an existing faster-whisper model directory containing model.bin")
    if not audio.is_file() or audio.stat().st_size == 0:
        raise ValueError("Expected a non-empty audio file")
    from faster_whisper import WhisperModel

    model = WhisperModel(str(model_dir), device=args.device, compute_type="int8", local_files_only=True)
    segments, info = model.transcribe(
        str(audio), language=None if args.language == "auto" else args.language,
        beam_size=5, vad_filter=True, condition_on_previous_text=False,
    )
    duration_ms = round(info.duration * 1000)
    result = []
    for segment in segments:
        text = segment.text.strip()
        start = max(0, round(segment.start * 1000))
        end = min(duration_ms, round(segment.end * 1000))
        if text and end > start:
            result.append({"id": f"s{len(result) + 1:06d}", "start_ms": start, "end_ms": end, "speaker": None, "text": text})
    if not result:
        raise ValueError("No speech was transcribed. Audio remains saved; no memory was created.")
    return {
        "schema_version": 1, "audio_sha256": audio_hash(audio), "duration_ms": duration_ms,
        "language": info.language, "asr": {"provider": "faster-whisper", "model": model_dir.name},
        "diarization": "none", "segments": result,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    acquire = commands.add_parser("download-model", help="Download model weights only; no audio is read")
    acquire.add_argument("--model", default="small", choices=["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"])
    acquire.add_argument("--output", required=True)
    run = commands.add_parser("transcribe")
    run.add_argument("--audio", required=True)
    run.add_argument("--model-dir", required=True)
    run.add_argument("--language", default="zh")
    run.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    args = parser.parse_args()
    if args.command == "download-model":
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        from faster_whisper.utils import download_model
        path = download_model(args.model, output_dir=str(Path(args.output).resolve()))
        print(json.dumps({"model_dir": path}))
    else:
        print(json.dumps(transcribe(args), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Voice worker failed: {exc}", file=sys.stderr)
        sys.exit(1)
