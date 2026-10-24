# Developer setup and API

Most users should follow the [Docker quick start](../README.md). This guide is for running from Python or changing the source.

## Getting started

You need Git, Python 3.10 or newer, and an internet connection for installation and the first model download. Development has been tested on Windows with Python 3.13. CPU inference works without a GPU, but cold starts and large images can be slow.

### Windows PowerShell

```powershell
git clone https://github.com/N0AH205/UniCut.git
cd UniCut
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe run.py
```

### Linux / macOS

```bash
git clone https://github.com/N0AH205/UniCut.git
cd UniCut
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run.py
```

Open **http://127.0.0.1:7860**. The launcher tries to open your browser automatically; on the first run, wait for server startup and reload if the page opens too early.

To start without opening a browser:

```bash
python -m uvicorn server:app --host 127.0.0.1 --port 7860
```

Run that command with your virtual environment's Python. On Windows, `run.bat` is also available when the desired Python environment is already active.

The default dependencies install the CPU ONNX runtime. The app detects other execution providers when a compatible runtime and its drivers are installed; see the [ONNX Runtime installation guide](https://onnxruntime.ai/docs/install/).

## Local API

Interactive API documentation is available at **http://127.0.0.1:7860/docs**.

```bash
curl -X POST http://127.0.0.1:7860/api/process \
  -F "file=@photo.jpg" \
  -F "model_name=birefnet-lite" \
  -F "enable_matting=true"
```

On Windows PowerShell, use `curl.exe` and put the command on one line. Processing responses include PNG data URLs, dimensions, an image-session ID, and timings.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Basic server health |
| `GET /api/models` | Available model and execution providers |
| `POST /api/process` | Segment and process an image |
| `POST /api/interactive-refine` | Apply keep/drop points |
| `POST /api/remat-trimap` | Apply RGBA brush strokes or a legacy trimap |
| `POST /api/adjust-post` | Adjust edges, despill, and generated shadows |
| `POST /api/batch-zip` | Package supplied cutouts as a ZIP |

For brush requests, send `image_base64`, `alpha_base64`, and `strokes_base64` (an RGBA PNG). Green marks keep, red marks erase, and yellow marks request matting. Existing `trimap_base64` requests are also supported. Unsupported segmentation model names return HTTP 422.

## Development

Install the Python dependencies above. Node.js 22 or newer is needed only for JavaScript tests; there is no frontend build step or npm installation.

```bash
python -m unittest discover -s tests -v
node --test tests/refinement.test.cjs
node --check static/js/app.js
node --check static/js/canvas.js
node --check static/js/api.js
node --check static/js/floating-panels.js
```

Regression tests cover mask handling, model selection, refinement, history, and stale-response protection. Heavy solvers are mocked in relevant unit tests to avoid model downloads and JIT startup; passing them is not a visual quality benchmark. CI is configured to run these checks on Windows and Linux.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for bug reports and contributions.


## Docker development checks

```bash
docker compose config --quiet
docker compose build
docker compose up --wait --wait-timeout 300
docker compose exec -T unicut python - < tests/docker_smoke.py
docker compose stop
```

The smoke test checks the non-root runtime, UI, health endpoint, and exact brush corrections without downloading model weights. The example input redirection uses Bash; in PowerShell use `Get-Content -Raw tests/docker_smoke.py | docker compose exec -T unicut python -`.

Do not install both `opencv-python` and `opencv-python-headless` in the same environment. UniCut uses the headless package because its interface runs in the browser.
