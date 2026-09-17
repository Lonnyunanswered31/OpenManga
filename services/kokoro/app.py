"""Local Kokoro-82M TTS service. Internal only (Docker network); never exposed publicly."""

import io
import logging
import os
import threading
import time

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format='{"ts":"%(asctime)s","level":"%(levelname)s","service":"kokoro","msg":"%(message)s"}')
log = logging.getLogger("kokoro")

SAMPLE_RATE = 24000
REPO_ID = os.environ.get("KOKORO_REPO_ID", "hexgrad/Kokoro-82M")
DEVICE = os.environ.get("KOKORO_DEVICE", "cpu")
MAX_CHARS = int(os.environ.get("KOKORO_MAX_CHARS", "5000"))
PRELOAD = [v for v in os.environ.get("KOKORO_PRELOAD_VOICES", "af_heart").split(",") if v]

VOICES = [
    ("af_heart", "Heart", "en-us", "female"), ("af_bella", "Bella", "en-us", "female"), ("af_nicole", "Nicole", "en-us", "female"),
    ("af_sarah", "Sarah", "en-us", "female"), ("af_sky", "Sky", "en-us", "female"), ("af_nova", "Nova", "en-us", "female"),
    ("af_river", "River", "en-us", "female"), ("af_jessica", "Jessica", "en-us", "female"), ("af_aoede", "Aoede", "en-us", "female"),
    ("af_kore", "Kore", "en-us", "female"), ("af_alloy", "Alloy", "en-us", "female"),
    ("am_michael", "Michael", "en-us", "male"), ("am_fenrir", "Fenrir", "en-us", "male"), ("am_puck", "Puck", "en-us", "male"),
    ("am_adam", "Adam", "en-us", "male"), ("am_echo", "Echo", "en-us", "male"), ("am_eric", "Eric", "en-us", "male"),
    ("am_liam", "Liam", "en-us", "male"), ("am_onyx", "Onyx", "en-us", "male"),
    ("bf_emma", "Emma", "en-gb", "female"), ("bf_isabella", "Isabella", "en-gb", "female"), ("bf_alice", "Alice", "en-gb", "female"),
    ("bf_lily", "Lily", "en-gb", "female"), ("bm_george", "George", "en-gb", "male"), ("bm_fable", "Fable", "en-gb", "male"),
    ("bm_lewis", "Lewis", "en-gb", "male"), ("bm_daniel", "Daniel", "en-gb", "male"),
    ("ef_dora", "Dora", "es", "female"), ("em_alex", "Alex", "es", "male"),
    ("ff_siwis", "Siwis", "fr-fr", "female"),
    ("if_sara", "Sara", "it", "female"), ("im_nicola", "Nicola", "it", "male"),
    ("pf_dora", "Dora", "pt-br", "female"), ("pm_alex", "Alex", "pt-br", "male"),
    ("hf_alpha", "Alpha", "hi", "female"), ("hm_omega", "Omega", "hi", "male"),
]
VOICE_IDS = {v[0] for v in VOICES}

state = {"status": "loading", "detail": "starting", "model_version": None, "loaded_at": None}
pipelines: dict = {}
model = None
lock = threading.Lock()


def _load():
    global model
    try:
        from kokoro import KModel, KPipeline  # noqa: F401  (heavy import)
        import kokoro

        state["detail"] = "downloading/loading model (first start can take a few minutes)"
        t = time.time()
        model = KModel(repo_id=REPO_ID).to(DEVICE).eval()
        for v in PRELOAD:
            _pipeline(v[0])
        state.update(status="ready", detail="ok", model_version=f"kokoro-82m/{getattr(kokoro, '__version__', 'unknown')}", loaded_at=time.time())
        log.info(f"model ready in {time.time() - t:.1f}s")
    except Exception as e:  # pragma: no cover - reported via /health
        state.update(status="error", detail=str(e)[:500])
        log.exception("model load failed")


def _pipeline(lang_code: str):
    from kokoro import KPipeline

    if lang_code not in pipelines:
        pipelines[lang_code] = KPipeline(lang_code=lang_code, repo_id=REPO_ID, model=model)
    return pipelines[lang_code]


threading.Thread(target=_load, daemon=True).start()
app = FastAPI(title="Kokoro TTS", docs_url=None, redoc_url=None)


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    voice: str = "af_heart"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    format: str = "wav"
    language: str | None = None


@app.get("/health")
def health():
    code = 200 if state["status"] == "ready" else 503
    return JSONResponse(state, status_code=code)


@app.get("/voices")
def voices():
    return {"voices": [{"id": i, "name": n, "language": lang, "gender": g} for i, n, lang, g in VOICES]}


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest):
    if state["status"] != "ready":
        raise HTTPException(status_code=503, detail=f"model {state['status']}: {state['detail']}")
    if req.voice not in VOICE_IDS:
        raise HTTPException(status_code=422, detail=f"unknown voice {req.voice}")
    if req.format != "wav":
        raise HTTPException(status_code=422, detail="only wav is supported; convert downstream with ffmpeg")
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="empty text")
    t = time.time()
    try:
        with lock:
            pipeline = _pipeline(req.voice[0])
            chunks = [np.asarray(audio, dtype=np.float32) for _, _, audio in pipeline(text, voice=req.voice, speed=req.speed, split_pattern=r"\n+") if audio is not None]
    except Exception as e:
        log.exception("synthesis failed")
        raise HTTPException(status_code=500, detail=f"synthesis error: {str(e)[:300]}") from e
    if not chunks:
        raise HTTPException(status_code=422, detail="no audio produced for text")
    audio = np.concatenate(chunks)
    buf = io.BytesIO()
    sf.write(buf, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    data = buf.getvalue()
    log.info(f"synthesized chars={len(text)} voice={req.voice} seconds={len(audio) / SAMPLE_RATE:.2f} latency={time.time() - t:.2f}s")
    return Response(content=data, media_type="audio/wav", headers={"x-model-version": state["model_version"] or "unknown", "x-sample-rate": str(SAMPLE_RATE)})
