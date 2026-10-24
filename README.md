# UniCut

UniCut is an open-source, locally run AI background-removal studio with batch processing, hair-edge matting, and manual refinement tools.

[![Tests](https://github.com/N0AH205/UniCut/actions/workflows/tests.yml/badge.svg)](https://github.com/N0AH205/UniCut/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Local-use beta.** Results depend on the image, and fine hair, glass, blur, and low-contrast boundaries can need manual correction. This repository does not claim a measured accuracy percentage or perfect extraction.

## Features

- BiRefNet Lite segmentation through ONNX Runtime.
- Optional alpha matting, edge shift, feathering, and color despill.
- Keep/drop point refinement and exact Keep/Erase brush corrections.
- Matte brush processing in local patches at the original image resolution.
- Batch processing and ZIP export.
- Original, cutout, alpha-mask, trimap, and split views.
- Background colors, custom backgrounds, and optional generated shadows.
- Undo/Redo, zoom and pan, resizable sidebars, and draggable floating controls.
- FastAPI endpoints for local integrations.

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

## Using the studio

1. Open or drop an image into the canvas.
2. Inspect the cutout on contrasting backgrounds and check the alpha mask.
3. Adjust matting, edges, and despill as needed.
4. Correct mistakes with the manual tools, then download the result.

For multiple images, choose **Batch process**, add your files, and export the completed results as a ZIP. Batch processing is sequential and results remain in the current browser session.

### Manual refinement

| Tool | Use | Apply with |
| --- | --- | --- |
| Keep point / Drop point | Guide a local segmentation correction | Run point refine |
| Keep brush | Set painted pixels fully opaque | Apply brush edits |
| Erase brush | Set painted pixels fully transparent | Apply brush edits |
| Matte brush | Estimate partial transparency along hair or other soft edges | Apply brush edits |
| Eraser / Reset marks | Remove guidance marks | No processing required |

For hair, paint a narrow Matte band across the edge, with Keep marks inside the foreground and Erase marks outside it. Unpainted alpha is preserved by brush refinement. If matting lacks foreground/background anchors, add guidance and try again.

Keep and Erase corrections are exact transparency edits; they do not depend on the matting solver. These tools do not remove lighting or shadows from skin or clothes.

Use the top-bar Undo/Redo buttons, **Ctrl/Cmd+Z** to undo, and **Ctrl/Cmd+Shift+Z** or **Ctrl+Y** to redo. History stores the last 12 edits for the current image. Loading or reprocessing an image resets history. Reset marks removes guidance; Undo restores applied results.

Drag the dotted handles to move the view selector and background controls. Double-click a handle to restore its default position.

## Model, privacy, and limitations

- The only segmentation model is [BiRefNet Lite ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX), which is listed under MIT. Weights download from Hugging Face on first use and are cached outside this repository.
- Image inference and refinement run in your local Python process. Images are sent from your browser to the local server, not to a hosted inference API.
- This is not fully offline by default: model loading can contact Hugging Face, and the UI loads DM Sans and JetBrains Mono from Google Fonts.
- Images and masks are held in a shared, in-memory cache of up to 16 sessions. Restarting the server loses that cache; browser refreshes lose the current editor state. This is not a durable project store.
- Automatic matting can resize large solve regions. Manual Matte-brush patches retain original resolution, but cannot guarantee recovery of indistinguishable or missing image detail.
- The app has no accounts, authentication, or public-service abuse controls. Keep it bound to localhost; do not expose it directly to the internet. See [SECURITY.md](SECURITY.md).

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for bug reports and contributions.

## License and acknowledgments

Original UniCut code is available under the [MIT License](LICENSE), copyright Noah Stephen and contributors. This permits commercial use subject to the license terms.

Third-party models, libraries, fonts, and bundled components retain their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the included [BiRefNet upstream notice](licenses/BiRefNet-MIT.txt). Model weights and dependency binaries are not included in this source repository.

Thanks to the BiRefNet, ONNX Runtime, PyMatting, OpenCV, FastAPI, and wider open-source communities whose work makes this project possible.
