# Third-party notices

UniCut's MIT License covers its original code. It does not relicense upstream
models, libraries, fonts, or their bundled components. Copyright and license
notices supplied by each upstream project remain applicable.

The Git repository is a source distribution without model weights, dependency
binaries, or font files. Docker builds install Python dependencies and Debian
runtime packages, retaining their installed license notices; model weights are
downloaded separately into a cache volume. The browser loads fonts from Google
Fonts. Redistributing a built image requires preserving the licenses applicable
to its exact contents.

## BiRefNet Lite

- Model: [onnx-community/BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX).
- The model repository lists the MIT License.
- Original project: [ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet).
- Upstream copyright: Copyright (c) 2024 ZhengPeng.
- The original project's MIT notice is reproduced in [licenses/BiRefNet-MIT.txt](licenses/BiRefNet-MIT.txt).

If you bundle weights in another distribution, retain the applicable notices
from the exact model revision you ship and review any conversion-specific
notices. UniCut does not include the weights in Git.

## Direct Python dependencies

Main project licenses are listed below. A binary wheel can include additional
libraries and notices; the project's top-level license alone is not a complete
inventory of a packaged installer.

| Package | Main license | Upstream |
| --- | --- | --- |
| FastAPI | MIT | [fastapi/fastapi](https://github.com/fastapi/fastapi) |
| Uvicorn | BSD-3-Clause | [encode/uvicorn](https://github.com/encode/uvicorn) |
| ONNX Runtime | MIT | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |
| NumPy | BSD-3-Clause, with additional component licenses | [numpy/numpy](https://github.com/numpy/numpy) |
| Pillow | MIT-CMU, with additional component licenses | [python-pillow/Pillow](https://github.com/python-pillow/Pillow) |
| OpenCV / opencv-python-headless | Apache-2.0, with additional component licenses | [opencv/opencv-python](https://github.com/opencv/opencv-python) |
| SciPy | BSD-3-Clause, with additional component licenses | [scipy/scipy](https://github.com/scipy/scipy) |
| PyMatting | MIT | [pymatting/pymatting](https://github.com/pymatting/pymatting) |
| huggingface-hub | Apache-2.0 | [huggingface/huggingface_hub](https://github.com/huggingface/huggingface_hub) |
| python-multipart | Apache-2.0 | [Kludex/python-multipart](https://github.com/Kludex/python-multipart) |
| Requests | Apache-2.0 | [psf/requests](https://github.com/psf/requests) |

### Indirect dependencies

The Windows development environment reviewed on 2026-10-24 also resolved the
following packages. The exact set and licenses can vary with versions, optional
extras, operating system, and wheel build. This list is informational, not a
replacement for the license texts supplied with those packages.

| Packages | License identifiers in the reviewed installation |
| --- | --- |
| pydantic, pydantic-core, annotated-types, typing-inspection | MIT |
| anyio, h11, PyYAML, filelock, charset-normalizer, urllib3 | MIT |
| starlette, click, fsspec, httpcore, httpx, idna, protobuf | BSD-3-Clause |
| colorama | BSD |
| numba | BSD |
| llvmlite | BSD-2-Clause AND Apache-2.0 WITH LLVM-exception |
| flatbuffers, hf-xet | Apache-2.0 |
| packaging | Apache-2.0 OR BSD-2-Clause |
| typing-extensions | PSF-2.0 |
| certifi | MPL-2.0 |
| tqdm | MPL-2.0 AND MIT |

Certifi and tqdm include MPL-covered material. Redistributing their files,
particularly modified files, requires following the applicable MPL terms;
UniCut's MIT License does not replace those obligations.

## Fonts

The stylesheet requests these fonts from Google Fonts:

- [DM Sans](https://github.com/google/fonts/tree/main/ofl/dmsans): SIL Open Font License 1.1.
- [JetBrains Mono](https://github.com/google/fonts/tree/main/ofl/jetbrainsmono): SIL Open Font License 1.1.

If you self-host or bundle the font files, include their copyright notices and
OFL license texts, and follow the font modification and naming conditions.

## Packaged applications and other distributions

Before shipping an executable, container image, or installer, inventory the
actual bundled files and include all required notices, license texts, and
source/relinking materials where applicable. In particular, review:

- [opencv-python third-party licenses](https://github.com/opencv/opencv-python/blob/4.x/LICENSE-3RD-PARTY.txt), including FFmpeg and any Qt components in your chosen build.
- NumPy/SciPy wheel notices for numerical libraries and compiler runtimes.
- ONNX Runtime and Pillow bundled-component notices.
- Python's license if bundling a Python interpreter.

Only publish example images and other assets that you created or have
permission to redistribute. The unused local demo product images are excluded
from this source release.
