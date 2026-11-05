"""GPT-SoVITS v2 zero-shot synthesis worker (CPU).

Runs under vendor/gptsovits-venv. Receives one JSON command on argv[1]:
  {mode:"synth", text, samplePath, promptText, out}
Loads the TTS stack once, normalizes the reference sample to 3-10 s, then
writes a 32 kHz wav to `out`.
"""
import json
import os
import sys

_SRC = None
_MODELS = None
_TTS = None


def _bootstrap(src, models):
    os.chdir(src)
    if src not in sys.path:
        sys.path.insert(0, src)
    if src + "/GPT_SoVITS" not in sys.path:
        sys.path.insert(0, src + "/GPT_SoVITS")
    os.environ["bert_path"] = models + "/chinese-roberta-wwm-ext-large"


def _load_tts(src, models):
    global _TTS
    if _TTS is None:
        _bootstrap(src, models)
        from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config

        _TTS = TTS(
            TTS_Config(
                {
                    "custom": {
                        "device": "cpu",
                        "is_half": False,
                        "version": "v2",
                        "t2s_weights_path": models
                        + "/gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt",
                        "vits_weights_path": models
                        + "/gsv-v2final-pretrained/s2G2333k.pth",
                        "cnhuhbert_base_path": models + "/chinese-hubert-base",
                        "bert_base_path": models
                        + "/chinese-roberta-wwm-ext-large",
                    }
                }
            )
        )
    return _TTS


def _normalize_ref(sample_path):
    """Return (wav_path, sr) with duration clamped into 3-10 s."""
    import soundfile as sf

    data, sr = sf.read(sample_path)
    target = sr * 3
    if len(data) < target:
        pad = target - len(data)
        import numpy as np

        data = np.concatenate([data, np.zeros(pad, dtype=data.dtype)])
    elif len(data) > sr * 10:
        data = data[: sr * 10]
    ref = os.path.join(
        os.path.dirname(os.path.abspath(sample_path)), ".gptsvits-ref.wav"
    )
    sf.write(ref, data, sr)
    return ref


def synth(cmd):
    src = cmd["src"]
    models = cmd["models"]
    out = cmd["out"]
    tts = _load_tts(src, models)
    ref = _normalize_ref(cmd["samplePath"])
    try:
        gen = tts.run(
            {
                "text": cmd["text"],
                "text_lang": "zh",
                "ref_audio_path": ref,
                "prompt_text": cmd.get("promptText", ""),
                "prompt_lang": "zh",
                "top_k": 15,
                "top_p": 1.0,
                "temperature": 1.0,
                "text_split_method": "cut5",
                "speed_factor": 1.0,
                "streaming_mode": False,
                "seed": -1,
            }
        )
        sr, audio = next(gen)
    finally:
        try:
            os.remove(ref)
        except OSError:
            pass
    import soundfile as sf

    sf.write(out, audio, sr)
    return {"sr": int(sr), "samples": int(len(audio))}


def main():
    cmd = json.loads(sys.argv[1])
    if cmd["mode"] != "synth":
        raise ValueError(f"unknown mode: {cmd.get('mode')}")
    result = synth(cmd)
    print(json.dumps({"ok": True, "data": result}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
