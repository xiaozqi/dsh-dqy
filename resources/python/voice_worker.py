import json
import os
import subprocess
import sys

_WHISPER = None
_WHISPER_MODEL = "small"


def get_whisper():
    global _WHISPER
    if _WHISPER is None:
        from faster_whisper import WhisperModel

        _WHISPER = WhisperModel(_WHISPER_MODEL, device="cpu", compute_type="int8")
    return _WHISPER


def transcribe(audio_path):
    segments, _ = get_whisper().transcribe(
        audio_path,
        language="zh",
        initial_prompt="以下是简体中文普通话的句子。",
    )
    return "".join(segment.text for segment in segments).strip()


def voice_meta(voice, voices_dir):
    meta_path = os.path.join(voices_dir, voice, "voice.json")
    if os.path.isfile(meta_path):
        with open(meta_path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    return None


def play_audio(path):
    try:
        from playsound3 import playsound

        playsound(path)
        return
    except Exception:
        pass
    try:
        from playsound import playsound  # legacy

        playsound(path)
        return
    except Exception:
        pass
    import winsound

    winsound.PlaySound(path, winsound.SND_FILENAME)  # wav fallback


def synth_edge_tts(text, voice, out_path):
    import asyncio

    import edge_tts

    async def run():
        tts = edge_tts.Communicate(text, voice)
        await tts.save(out_path)

    asyncio.run(run())


def synth_gptsovits(text, meta, out_path, gptsovits_python, synth_worker, src, models):
    """Synthesize with a cloned voice through the GPT-SoVITS sub-process.

    Absolute paths only: the sub-process chdirs into the GPT-SoVITS source tree.
    """
    subprocess.run(
        [
            gptsovits_python,
            synth_worker,
            json.dumps(
                {
                    "mode": "synth",
                    "text": text,
                    "samplePath": os.path.abspath(meta["samplePath"]),
                    "promptText": meta.get("promptText", ""),
                    "out": os.path.abspath(out_path),
                    "src": os.path.abspath(src),
                    "models": os.path.abspath(models),
                },
                ensure_ascii=False,
            ),
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def normalize_sample(sample_path, voice_dir):
    """Convert the reference sample to wav and clamp duration into 3-10 s.

    Uses PyAV (shipped with faster-whisper) so any container format works and
    the sandbox interpreter needs no extra audio package.
    """
    import av
    import numpy as np

    frames = []
    with av.open(sample_path) as container:
        for frame in container.decode(audio=0):
            arr = frame.to_ndarray()
            if arr.ndim == 1:
                arr = arr.reshape(1, -1)
            frames.append(arr)
            if sum(f.shape[1] for f in frames) > 10 * frame.sample_rate:
                break
        sr = frame.sample_rate
    data = np.concatenate(frames, axis=1)
    if data.ndim > 1 and data.shape[0] > 1:
        data = data.mean(axis=0)
    data = data.reshape(-1)
    if np.issubdtype(data.dtype, np.floating):
        data = data.astype(np.float32)  # planar float frames are already -1..1
    else:
        data = data.astype(np.float32) / 32768.0
    target = sr * 3
    if len(data) < target:
        data = np.concatenate([data, np.zeros(target - len(data), dtype=data.dtype)])
    elif len(data) > sr * 10:
        data = data[: sr * 10]
    norm_path = os.path.join(voice_dir, "sample.wav")
    with av.open(norm_path, "w") as out:
        stream = out.add_stream("pcm_s16le", rate=sr)
        stream.layout = "mono"
        packed = (data * 32768.0).clip(-32768, 32767).astype(np.int16)
        for i in range(0, len(packed), 8192):
            chunk = np.expand_dims(packed[i : i + 8192], 0)
            frame = av.AudioFrame.from_ndarray(chunk, format="s16", layout="mono")
            frame.sample_rate = sr
            for packet in stream.encode(frame):
                out.mux(packet)
        for packet in stream.encode():
            out.mux(packet)
    return norm_path


def synth_speak(
    text,
    voice,
    out_path,
    play,
    voices_dir,
    gptsovits_python,
    synth_worker,
    gptsovits_src,
    gptsovits_models_dir,
):
    meta = voice_meta(voice, voices_dir) if voices_dir else None
    if meta is not None:
        result_path = out_path + ".wav"
        synth_gptsovits(
            text,
            meta,
            result_path,
            gptsovits_python,
            synth_worker,
            gptsovits_src,
            gptsovits_models_dir,
        )
    else:
        result_path = out_path + ".mp3"
        synth_edge_tts(text, voice, result_path)
    duration_ms = None
    if play:
        play_audio(result_path)
    return {"audioPath": result_path, "durationMs": duration_ms}


def clone_voice(sample_path, name, voices_dir):
    voice_dir = os.path.join(voices_dir, name)
    os.makedirs(voice_dir, exist_ok=True)
    norm_path = normalize_sample(sample_path, voice_dir)
    prompt_text = transcribe(norm_path)
    meta = {
        "name": name,
        "samplePath": norm_path,
        "promptText": prompt_text,
    }
    meta_path = os.path.join(voice_dir, "voice.json")
    with open(meta_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    return meta


def listen_local(audio_path):
    return transcribe(audio_path)


def listen_phone(adb_path, device_serial, duration_ms, remote_path, local_path):
    serial_args = ["-s", device_serial] if device_serial else []
    seconds = max(1, int(duration_ms / 1000))
    subprocess.run(
        [
            adb_path,
            *serial_args,
            "shell",
            "screenrecord",
            "--time-limit",
            str(seconds),
            "--microphone",
            remote_path,
        ],
        check=True,
    )
    subprocess.run(
        [adb_path, *serial_args, "pull", remote_path, local_path],
        check=True,
    )
    subprocess.run(
        [adb_path, *serial_args, "shell", "rm", "-f", remote_path],
        check=True,
    )
    return transcribe(local_path)


def main():
    cmd = json.loads(sys.argv[1])
    mode = cmd["mode"]
    if mode == "speak":
        data = synth_speak(
            cmd["text"],
            cmd.get("voice", "zh-CN-XiaoxiaoNeural"),
            cmd["out"],
            bool(cmd.get("play", False)),
            cmd.get("voicesDir", ""),
            cmd.get("gptsovitsPythonPath", ""),
            cmd.get("gptsovitsSynthWorker", ""),
            cmd.get("gptsovitsSrc", ""),
            cmd.get("gptsovitsModelsDir", ""),
        )
    elif mode == "clone":
        data = clone_voice(
            cmd["sample"],
            cmd.get("name", "mine"),
            cmd["voicesDir"],
        )
    elif mode == "listen":
        data = listen_local(cmd["audio"])
    elif mode == "play":
        play_audio(cmd["audio"])
        data = {"played": cmd["audio"]}
    elif mode == "listen_phone":
        data = listen_phone(
            cmd["adbPath"],
            cmd.get("deviceSerial", ""),
            int(cmd.get("durationMs", 5000)),
            cmd["remote"],
            cmd["local"],
        )
    else:
        raise ValueError(f"unknown mode: {mode}")
    print(json.dumps({"ok": True, "data": data}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
