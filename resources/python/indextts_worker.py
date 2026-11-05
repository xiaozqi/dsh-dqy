"""IndexTTS-2 emotion-controllable TTS worker.

Runs under vendor/indextts-venv. Two modes:
  serve  -- persistent process, reads one JSON command per line from stdin,
           writes one JSON result line per command, keeps models loaded.
  synth  -- one-shot mode for smoke tests: command passed via argv[1].

Command fields (synth):
  text, samplePath, out, src, models, emoVector (8 floats | null),
  emoText (string | null)
Emotion vector order: [happy, angry, sad, afraid, disgusted, melancholic,
surprised, calm].
"""
import json
import os
import sys

_TTS = None


def _bootstrap(src):
    if src and src not in sys.path:
        sys.path.insert(0, src)


def _load_tts(src, models):
    global _TTS
    if _TTS is None:
        _bootstrap(src)
        from indextts.infer_v2 import IndexTTS2

        _TTS = IndexTTS2(
            cfg_path=os.path.join(models, "config.yaml"),
            model_dir=models,
            device="cpu",
            use_qwen_emo=True,
        )
    return _TTS


def synth(cmd):
    tts = _load_tts(cmd["src"], cmd["models"])
    kwargs = {}
    if cmd.get("emoVector"):
        kwargs["emo_vector"] = cmd["emoVector"]
    elif cmd.get("emoText"):
        kwargs["use_emo_text"] = True
        kwargs["emo_text"] = cmd["emoText"]
    tts.infer(
        spk_audio_prompt=cmd["samplePath"],
        text=cmd["text"],
        output_path=cmd["out"],
        use_random=False,
        verbose=False,
        **kwargs,
    )
    if not os.path.isfile(cmd["out"]):
        raise RuntimeError("IndexTTS-2 did not produce output file")
    return {"samples": os.path.getsize(cmd["out"])}


def handle(cmd):
    if cmd.get("mode") != "synth":
        raise ValueError(f"unknown mode: {cmd.get('mode')}")
    return synth(cmd)


def _run_command(cmd):
    try:
        data = handle(cmd)
        print(json.dumps({"ok": True, "data": data}, ensure_ascii=False), flush=True)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            _run_command(json.loads(line))
        return
    if len(sys.argv) > 1:
        _run_command(json.loads(sys.argv[1]))
        return
    _run_command(json.loads(sys.stdin.read()))


if __name__ == "__main__":
    main()
