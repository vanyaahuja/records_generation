import importlib.util
import wave
from array import array

import pytest


@pytest.mark.skipif(
    importlib.util.find_spec("faster_whisper") is None,
    reason="Optional faster-whisper package is not installed",
)
def test_faster_whisper_decoder_accepts_audio_with_installed_pyav(tmp_path):
    from faster_whisper.audio import decode_audio

    audio_path = tmp_path / "sample.wav"
    samples = array("h", [0] * 1600)
    with wave.open(str(audio_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(samples.tobytes())

    decoded = decode_audio(str(audio_path))

    assert decoded.size == 1600
