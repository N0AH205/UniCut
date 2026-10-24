import os
import io
import time
import base64
import binascii
import uuid
import threading
from collections import OrderedDict
import logging
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError
import zipfile
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

from core.pipeline import pipeline
from core.matting_engine import MattingError
from core.interactive import InteractiveRefiner
from core.postprocessor import MaskPostprocessor
from core.despill import ColorDespill
from core.shadow import ShadowGenerator
from core.model_manager import model_manager, MODEL_REGISTRY

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("UniCut.Server")

app = FastAPI(
    title="UniCut AI API",
    description="Custom, Private, Self-Hosted Multi-Stage Background Removal & Alpha Matting Studio",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ImageSessionCache:
    def __init__(self, max_items: int = 16):
        self.max_items = max_items
        self._cache = OrderedDict()
        self._lock = threading.Lock()

    def put(self, img_rgb: np.ndarray, base_alpha: np.ndarray) -> str:
        session_id = uuid.uuid4().hex[:12]
        with self._lock:
            if len(self._cache) >= self.max_items:
                self._cache.popitem(last=False)
            self._cache[session_id] = {
                "img_rgb": img_rgb,
                "base_alpha": base_alpha,
                "updated_at": time.time()
            }
        return session_id

    def update_alpha(self, session_id: str, new_alpha: np.ndarray):
        with self._lock:
            if session_id in self._cache:
                self._cache[session_id]["base_alpha"] = new_alpha
                self._cache[session_id]["updated_at"] = time.time()
                self._cache.move_to_end(session_id)

    def get(self, session_id: str):
        if not session_id:
            return None, None
        with self._lock:
            item = self._cache.get(session_id)
            if item:
                self._cache.move_to_end(session_id)
                return item["img_rgb"], item["base_alpha"]
        return None, None

image_cache = ImageSessionCache(max_items=16)

def image_to_base64(img_arr: np.ndarray, format: str = "PNG") -> str:
    if img_arr.ndim == 2:
        pil_img = Image.fromarray(img_arr.astype(np.uint8))
    elif img_arr.shape[2] == 4:
        pil_img = Image.fromarray(img_arr.astype(np.uint8), mode="RGBA")
    else:
        pil_img = Image.fromarray(img_arr.astype(np.uint8), mode="RGB")

    buf = io.BytesIO()
    if format.upper() == "PNG":
        pil_img.save(buf, format="PNG", compress_level=1)
    else:
        pil_img.save(buf, format=format, optimize=False)
    b64_str = base64.b64encode(buf.getvalue()).decode("utf-8")
    mime = "image/png" if format.upper() == "PNG" else "image/jpeg"
    return f"data:{mime};base64,{b64_str}"

def base64_to_image(b64_str: str) -> np.ndarray:
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]
    data = base64.b64decode(b64_str)
    pil_img = Image.open(io.BytesIO(data)).convert("RGB")
    return np.array(pil_img)

def base64_to_mask(b64_str: str) -> np.ndarray:
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]
    data = base64.b64decode(b64_str)
    pil_img = Image.open(io.BytesIO(data)).convert("L")
    return np.array(pil_img, dtype=np.float32) / 255.0

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "UniCut AI", "timestamp": time.time()}

@app.get("/api/models")
def get_models():
    return model_manager.list_models()

@app.get("/api/samples")
def list_samples():
    sample_dir = os.path.join(os.path.dirname(__file__), "static", "samples")
    samples = []
    if os.path.exists(sample_dir):
        for f in os.listdir(sample_dir):
            if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                name = os.path.splitext(f)[0].replace("_", " ").title()
                samples.append({
                    "id": f,
                    "title": name,
                    "url": f"/static/samples/{f}"
                })
    return {"samples": samples}

@app.post("/api/process")
async def process_image(
    file: Optional[UploadFile] = File(None),
    sample_id: Optional[str] = Form(None),
    image_base64: Optional[str] = Form(None),
    model_name: str = Form("birefnet-lite"),
    enable_matting: bool = Form(True),
    matting_method: str = Form("lkm"),
    trimap_radius: int = Form(12),
    enable_tiling: bool = Form(False),
    tile_size: int = Form(1024),
    despill_mode: str = Form("auto"),
    despill_strength: float = Form(0.8),
    edge_shift: int = Form(0),
    edge_feather: float = Form(0.0),
    gamma: float = Form(1.0),
    contrast: float = Form(1.0),
    shadow_type: str = Form("none"),
    shadow_blur: int = Form(20),
    shadow_opacity: float = Form(0.6),
    shadow_offset_x: int = Form(0),
    shadow_offset_y: int = Form(15),
    shadow_scale: float = Form(0.25)
):
    try:
        if file is not None:
            contents = await file.read()
            pil_img = Image.open(io.BytesIO(contents)).convert("RGB")
            img_rgb = np.array(pil_img)
        elif sample_id:
            sample_path = os.path.join(os.path.dirname(__file__), "static", "samples", sample_id)
            if not os.path.exists(sample_path):
                raise HTTPException(status_code=404, detail="Sample image not found")
            pil_img = Image.open(sample_path).convert("RGB")
            img_rgb = np.array(pil_img)
        elif image_base64:
            img_rgb = base64_to_image(image_base64)
        else:
            raise HTTPException(status_code=400, detail="No image file, sample_id, or image_base64 provided")

        if model_name not in MODEL_REGISTRY:
            raise HTTPException(status_code=422, detail="Unsupported model. Use birefnet-lite.")

        h, w = img_rgb.shape[:2]
        logger.info(f"Processing image {w}x{h} with model '{model_name}', matting={enable_matting}, despill={despill_mode}")

        result = pipeline.process(
            img_rgb=img_rgb,
            model_name=model_name,
            enable_matting=enable_matting,
            matting_method=matting_method,
            trimap_radius=trimap_radius,
            enable_tiling=enable_tiling,
            tile_size=tile_size,
            despill_mode=despill_mode,
            despill_strength=despill_strength,
            edge_shift=edge_shift,
            edge_feather=edge_feather,
            gamma=gamma,
            contrast=contrast
        )

        rgba_cutout = result["rgba_cutout"]
        alpha_mask = result["alpha_mask"]
        trimap_vis = result["trimap_vis"]

        # Apply shadow if requested
        if shadow_type == "drop":
            sh_mask = ShadowGenerator.generate_drop_shadow(
                alpha_mask,
                blur=shadow_blur,
                opacity=shadow_opacity,
                offset_x=shadow_offset_x,
                offset_y=shadow_offset_y
            )
            rgba_cutout = ShadowGenerator.composite_with_shadow(result["despilled_rgb"], alpha_mask, sh_mask)
        elif shadow_type == "contact":
            sh_mask = ShadowGenerator.generate_contact_shadow(
                alpha_mask,
                blur=shadow_blur,
                opacity=shadow_opacity,
                scale_y=shadow_scale,
                shear_x=float(shadow_offset_x) * 0.02
            )
            rgba_cutout = ShadowGenerator.composite_with_shadow(result["despilled_rgb"], alpha_mask, sh_mask)

        session_id = image_cache.put(img_rgb, alpha_mask)

        cutout_b64 = image_to_base64(rgba_cutout, format="PNG")
        alpha_u8 = (alpha_mask * 255.0).astype(np.uint8)
        alpha_b64 = image_to_base64(alpha_u8, format="PNG")
        trimap_b64 = image_to_base64(trimap_vis, format="PNG")
        orig_b64 = image_to_base64(img_rgb, format="PNG")

        return {
            "success": True,
            "image_id": session_id,
            "width": w,
            "height": h,
            "cutout_url": cutout_b64,
            "alpha_url": alpha_b64,
            "base_alpha_url": image_to_base64((result["base_alpha"] * 255).astype(np.uint8), format="PNG"),
            "trimap_url": trimap_b64,
            "orig_url": orig_b64,
            "model_name": model_name,
            "metrics": result["metrics"]
        }
    except HTTPException:
        raise
    except MattingError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except (UnidentifiedImageError, binascii.Error) as e:
        raise HTTPException(status_code=400, detail="Invalid image data") from e
    except Exception as e:
        logger.error(f"Error in process_image: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Image processing failed. Please try again.") from e

class InteractiveRefineRequest(BaseModel):
    image_id: Optional[str] = None
    image_base64: Optional[str] = None
    mask_base64: Optional[str] = None
    fg_points: List[Dict[str, int]]
    bg_points: List[Dict[str, int]]
    point_radius: int = 10
    despill_mode: str = "auto"
    despill_strength: float = 0.8
    edge_shift: int = 0
    edge_feather: float = 0.0

@app.post("/api/interactive-refine")
def interactive_refine(req: InteractiveRefineRequest):
    try:
        t0 = time.time()
        cached_img, cached_alpha = image_cache.get(req.image_id) if req.image_id else (None, None)

        if cached_img is not None and cached_alpha is not None:
            img_rgb = cached_img
            base_mask = cached_alpha
        elif req.image_base64 and req.mask_base64:
            img_rgb = base64_to_image(req.image_base64)
            base_mask = base64_to_mask(req.mask_base64)
        else:
            raise HTTPException(status_code=400, detail="Missing image data or session expired")

        refined_alpha = InteractiveRefiner.refine_with_points(
            img_rgb=img_rgb,
            base_mask=base_mask,
            fg_points=req.fg_points,
            bg_points=req.bg_points,
            point_radius=req.point_radius
        )

        post_alpha = MaskPostprocessor.refine_alpha(
            refined_alpha,
            shift=req.edge_shift,
            feather=req.edge_feather
        )

        if req.image_id:
            image_cache.update_alpha(req.image_id, post_alpha)

        despilled_rgb = ColorDespill.apply_despill(
            img_rgb,
            post_alpha,
            mode=req.despill_mode,
            strength=req.despill_strength
        )

        cutout = MaskPostprocessor.create_rgba_cutout(despilled_rgb, post_alpha)

        return {
            "success": True,
            "image_id": req.image_id,
            "cutout_url": image_to_base64(cutout, format="PNG"),
            "alpha_url": image_to_base64((post_alpha * 255).astype(np.uint8), format="PNG"),
            "refine_ms": round((time.time() - t0) * 1000, 1)
        }
    except HTTPException:
        raise
    except MattingError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except (UnidentifiedImageError, binascii.Error) as e:
        raise HTTPException(status_code=400, detail="Invalid image data") from e
    except Exception as e:
        logger.error(f"Error in interactive_refine: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Image processing failed. Please try again.") from e

class RematTrimapRequest(BaseModel):
    image_id: Optional[str] = None
    image_base64: Optional[str] = None
    trimap_base64: Optional[str] = None
    strokes_base64: Optional[str] = None
    alpha_base64: Optional[str] = None
    matting_method: str = "lkm"
    despill_mode: str = "auto"
    despill_strength: float = 0.8

@app.post("/api/remat-trimap")
def remat_trimap(req: RematTrimapRequest):
    try:
        t0 = time.time()
        cached_img, cached_alpha = image_cache.get(req.image_id) if req.image_id else (None, None)

        if cached_img is not None:
            img_rgb = cached_img
        elif req.image_base64:
            img_rgb = base64_to_image(req.image_base64)
        else:
            raise HTTPException(status_code=400, detail="Missing image data or session expired")

        if req.strokes_base64:
            if req.alpha_base64:
                base_alpha = base64_to_mask(req.alpha_base64)
            elif cached_alpha is not None:
                base_alpha = cached_alpha
            else:
                raise HTTPException(status_code=400, detail="Brush edits require the current alpha mask")
            b64 = req.strokes_base64.split(",", 1)[-1]
            strokes = np.array(Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGBA"))
            alpha = InteractiveRefiner.refine_with_strokes(
                img_rgb, base_alpha, strokes, method=req.matting_method
            )
        elif req.trimap_base64:
            b64 = req.trimap_base64.split(",", 1)[-1]
            pil_trimap = Image.open(io.BytesIO(base64.b64decode(b64))).convert("L")
            raw_trimap = np.array(pil_trimap, dtype=np.float32)
            user_trimap = np.full(raw_trimap.shape, 0.5, dtype=np.float32)
            user_trimap[raw_trimap < 64] = 0.0
            user_trimap[raw_trimap > 192] = 1.0
            alpha = InteractiveRefiner.refine_with_trimap(img_rgb, user_trimap, method=req.matting_method)
        else:
            raise HTTPException(status_code=400, detail="Provide brush strokes or a trimap")

        if req.image_id:
            image_cache.update_alpha(req.image_id, alpha)

        despilled_rgb = ColorDespill.apply_despill(
            img_rgb,
            alpha,
            mode=req.despill_mode,
            strength=req.despill_strength
        )

        cutout = MaskPostprocessor.create_rgba_cutout(despilled_rgb, alpha)

        return {
            "success": True,
            "image_id": req.image_id,
            "cutout_url": image_to_base64(cutout, format="PNG"),
            "alpha_url": image_to_base64((alpha * 255).astype(np.uint8), format="PNG"),
            "matting_ms": round((time.time() - t0) * 1000, 1)
        }
    except HTTPException:
        raise
    except MattingError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except (UnidentifiedImageError, binascii.Error) as e:
        raise HTTPException(status_code=400, detail="Invalid image data") from e
    except Exception as e:
        logger.error(f"Error in remat_trimap: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Image processing failed. Please try again.") from e

class PostAdjustRequest(BaseModel):
    image_id: Optional[str] = None
    image_base64: Optional[str] = None
    alpha_base64: Optional[str] = None
    edge_shift: int = 0
    edge_feather: float = 0.0
    gamma: float = 1.0
    contrast: float = 1.0
    despill_mode: str = "auto"
    despill_strength: float = 0.8
    shadow_type: str = "none"
    shadow_blur: int = 20
    shadow_opacity: float = 0.6
    shadow_offset_x: int = 0
    shadow_offset_y: int = 15
    shadow_scale: float = 0.25

@app.post("/api/adjust-post")
def adjust_post(req: PostAdjustRequest):
    try:
        t0 = time.time()
        cached_img, cached_alpha = image_cache.get(req.image_id) if req.image_id else (None, None)

        if cached_img is not None and cached_alpha is not None:
            img_rgb = cached_img
            base_alpha = cached_alpha
        elif req.image_base64 and req.alpha_base64:
            img_rgb = base64_to_image(req.image_base64)
            base_alpha = base64_to_mask(req.alpha_base64)
        else:
            raise HTTPException(status_code=400, detail="Missing image data or session expired")

        refined_alpha = MaskPostprocessor.refine_alpha(
            base_alpha,
            shift=req.edge_shift,
            feather=req.edge_feather,
            gamma=req.gamma,
            contrast=req.contrast
        )

        despilled_rgb = ColorDespill.apply_despill(
            img_rgb,
            refined_alpha,
            mode=req.despill_mode,
            strength=req.despill_strength
        )

        cutout = MaskPostprocessor.create_rgba_cutout(despilled_rgb, refined_alpha)

        if req.shadow_type == "drop":
            sh_mask = ShadowGenerator.generate_drop_shadow(
                refined_alpha,
                blur=req.shadow_blur,
                opacity=req.shadow_opacity,
                offset_x=req.shadow_offset_x,
                offset_y=req.shadow_offset_y
            )
            cutout = ShadowGenerator.composite_with_shadow(despilled_rgb, refined_alpha, sh_mask)
        elif req.shadow_type == "contact":
            sh_mask = ShadowGenerator.generate_contact_shadow(
                refined_alpha,
                blur=req.shadow_blur,
                opacity=req.shadow_opacity,
                scale_y=req.shadow_scale,
                shear_x=float(req.shadow_offset_x) * 0.02
            )
            cutout = ShadowGenerator.composite_with_shadow(despilled_rgb, refined_alpha, sh_mask)

        return {
            "success": True,
            "image_id": req.image_id,
            "cutout_url": image_to_base64(cutout, format="PNG"),
            "alpha_url": image_to_base64((refined_alpha * 255).astype(np.uint8), format="PNG"),
            "adjust_ms": round((time.time() - t0) * 1000, 1)
        }
    except HTTPException:
        raise
    except MattingError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except (UnidentifiedImageError, binascii.Error) as e:
        raise HTTPException(status_code=400, detail="Invalid image data") from e
    except Exception as e:
        logger.error(f"Error in adjust_post: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Image processing failed. Please try again.") from e

class BatchZipItem(BaseModel):
    filename: str
    cutout_base64: str

class BatchZipRequest(BaseModel):
    items: List[BatchZipItem]

@app.post("/api/batch-zip")
def generate_batch_zip(req: BatchZipRequest):
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for idx, item in enumerate(req.items):
            b64 = item.cutout_base64
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            try:
                data = base64.b64decode(b64)
                name = item.filename or f"cutout_{idx + 1}.png"
                root, _ = os.path.splitext(name)
                clean_name = f"{root}_cutout.png"
                zf.writestr(clean_name, data)
            except Exception as e:
                logger.warning(f"Error packing {item.filename}: {e}")
    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=unicut_batch_cutouts.zip"}
    )

static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def serve_index():
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "UniCut AI API is active. UI file not found."}

@app.get("/favicon.ico", include_in_schema=False)
def serve_favicon():
    fav_file = os.path.join(static_dir, "favicon.ico")
    if os.path.exists(fav_file):
        return FileResponse(fav_file)
    return JSONResponse(status_code=404, content={"message": "Favicon not found"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=7860, reload=False)
