import base64
import io
import json
import os
import urllib.request

import numpy as np
from PIL import Image


def encode(array):
    output = io.BytesIO()
    Image.fromarray(array).save(output, format="PNG")
    return base64.b64encode(output.getvalue()).decode("ascii")


assert os.getuid() != 0, "The container must run as a non-root user"
with urllib.request.urlopen("http://127.0.0.1:7860/api/health", timeout=10) as response:
    assert json.load(response)["status"] == "ok"
with urllib.request.urlopen("http://127.0.0.1:7860/", timeout=10) as response:
    assert b"Apply brush edits" in response.read()

image = np.full((16, 16, 3), 128, dtype=np.uint8)
alpha = np.full((16, 16), 128, dtype=np.uint8)
strokes = np.zeros((16, 16, 4), dtype=np.uint8)
strokes[4, 4] = [34, 197, 94, 217]
strokes[8, 8] = [239, 68, 68, 217]
payload = {
    "image_base64": encode(image),
    "alpha_base64": encode(alpha),
    "strokes_base64": encode(strokes),
    "despill_mode": "none",
}
request = urllib.request.Request(
    "http://127.0.0.1:7860/api/remat-trimap",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(request, timeout=30) as response:
    result = json.load(response)
assert result["success"]
mask = Image.open(io.BytesIO(base64.b64decode(result["alpha_url"].split(",", 1)[1])))
assert mask.getpixel((4, 4)) == 255
assert mask.getpixel((8, 8)) == 0
assert mask.getpixel((0, 0)) == 128
print("Container smoke test passed: non-root runtime, UI, health, and brush API")
