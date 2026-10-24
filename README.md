# UniCut

Remove image backgrounds on your own computer, with batch processing and manual tools for difficult edges and hair.

[![Tests](https://github.com/N0AH205/UniCut/actions/workflows/tests.yml/badge.svg)](https://github.com/N0AH205/UniCut/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Preview

### Compare the original and cutout

Use the split-view slider to inspect the original photo alongside the transparent-background result.

![UniCut split view comparing a basketball photo with its transparent-background cutout](docs/screenshots/split-view.png)

<details>
<summary>More screenshots: workspace, batch processing, backgrounds, and trimap</summary>

### The workspace

Upload an image, choose a view, and access the refinement tools and processing controls in one workspace.

![UniCut workspace showing the upload area, refinement toolbar, processing controls, and export options](docs/screenshots/workspace.png)

### Batch processing

Queue multiple images and choose shared processing settings before starting the batch.

![UniCut Batch Processing Studio with seven queued images and shared model, matting, shadow, and despill settings](docs/screenshots/batch-processing.png)

### Background previews

Check your cutout against different background colors before exporting it.

![UniCut split view comparing a group photo with a green-background preview](docs/screenshots/background-preview.png)

### Trimap inspection

Inspect foreground regions and uncertain edges in the trimap view when refining a result.

![UniCut trimap view showing foreground regions in green and uncertain boundaries in yellow](docs/screenshots/trimap.png)

</details>

## Start using UniCut

### Windows: download and double-click

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and open it. Wait until Docker is running.
2. [Download UniCut](https://github.com/N0AH205/UniCut/archive/refs/heads/main.zip) and **extract the ZIP**.
3. Open the extracted folder and double-click **Start UniCut.bat**.

The first setup downloads the software and can take several minutes. Your browser opens when the app is ready. No Python, Git, or Node.js setup is needed.

Upload a photo, inspect the result, and choose **Download cutout**. When finished, double-click **Stop UniCut.bat**. Downloaded AI model files are kept for next time.

### macOS / Linux, or using a terminal

Install Docker Desktop (or Docker Engine with Compose on Linux), download and extract UniCut, then open a terminal in that folder and run:

```bash
docker compose up --build --wait --wait-timeout 300
```

Open **http://127.0.0.1:7860**. To stop the app:

```bash
docker compose stop
```

## What you can do

- Remove backgrounds with BiRefNet Lite and optional alpha matting.
- Process a batch of images and download a ZIP.
- Correct edges with Keep, Erase, and Matte brushes or keep/drop points.
- Compare the original, cutout, and alpha mask; use different backgrounds.
- Undo/Redo edits, adjust edges and color spill, and add optional generated shadows.

**Local-use beta:** fine hair, glass, blur, and low-contrast boundaries can still need correction. Perfect extraction is not guaranteed.

## Fixing a result

| Want to... | Use this tool | Then click |
| --- | --- | --- |
| Restore a missing solid area | Keep brush | Apply brush edits |
| Remove leftover background | Erase brush | Apply brush edits |
| Refine hair or a soft edge | Matte brush along the edge; Keep inside and Erase outside | Apply brush edits |
| Guide a larger local correction | Keep point / Drop point | Run point refine |

Keep and Erase brushes set transparency exactly. Matte brush estimates partial transparency in local patches at the original image resolution. These tools edit the cutout, not the lighting on a person's skin or clothes.

Use the top-bar Undo/Redo icons or **Ctrl/Cmd+Z** and **Ctrl/Cmd+Shift+Z**. **Reset marks** only clears guidance; Undo restores applied edits. The last 12 edits are kept for the current image. Refreshing, loading, or reprocessing an image can reset your work, so download results you want to keep.

## A few things to know

- **First photo:** UniCut downloads and loads the AI model. This can be slow, especially on CPU. Later uses reuse the cached files.
- **Where it runs:** this Docker setup uses your computer's CPU. No paid inference account or GPU is required.
- **Privacy:** image processing runs locally. Setup and model downloads need internet access, and the browser requests fonts from Google Fonts.
- **Saved files:** Docker keeps downloaded model and compiler caches in a named volume. It does not save your editing session or uploaded photos as a project.
- **Local access:** the Docker port is published only on `127.0.0.1`. UniCut has no login or public-service protections; do not expose it to the internet. See [SECURITY.md](SECURITY.md).

## Troubleshooting

**Docker is not running:** open Docker Desktop and wait for it to finish starting. On Windows, use Linux containers.

**Port 7860 is already in use:** stop the other copy of UniCut. In PowerShell, you can also start on another port:

```powershell
$env:UNICUT_PORT = "7861"
docker compose up --build --wait --wait-timeout 300
```

Then open http://127.0.0.1:7861.

**Large photos fail:** check Docker Desktop's available memory, try a smaller image, or turn off automatic matting. Processing time and memory use depend on the photo and settings.

**Something else went wrong:** run `docker compose logs --tail 100` in the UniCut folder and include the error when [reporting a bug](https://github.com/N0AH205/UniCut/issues). Do not share private photos or credentials.

## Updating

Download a fresh ZIP and run **Start UniCut.bat**, or run `git pull` followed by `docker compose up --build --wait --wait-timeout 300` if you use Git. The named cache volume is reused. Avoid deleting Docker volumes if you want to keep downloaded models.

## Developers

For Python installation, tests, Docker checks, and the REST API, see [the developer guide](docs/DEVELOPMENT.md). There is no frontend build step. Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Original UniCut code is available under the [MIT License](LICENSE), copyright Noah Stephen and contributors. Third-party models, libraries, fonts, and bundled components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The model is [BiRefNet Lite ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX), listed under MIT. Weights are downloaded separately and are not baked into the Docker image. The [upstream BiRefNet notice](licenses/BiRefNet-MIT.txt) is included.
