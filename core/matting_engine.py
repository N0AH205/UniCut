import cv2
import numpy as np
import pymatting
import logging
from typing import Tuple, Optional

logger = logging.getLogger("UniCut.MattingEngine")

class MattingError(RuntimeError):
    """Raised when no matting solver can produce a usable alpha mask."""


class MattingEngine:
    @staticmethod
    def generate_trimap(
        mask: np.ndarray,
        radius: int = 12,
        fg_threshold: float = 0.85,
        bg_threshold: float = 0.15
    ) -> np.ndarray:
        radius = max(1, int(radius))
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))

        fg_seed = (mask >= fg_threshold).astype(np.uint8) * 255
        bg_seed = (mask <= bg_threshold).astype(np.uint8) * 255

        eroded_fg = cv2.erode(fg_seed, kernel, iterations=1)
        eroded_bg = cv2.erode(bg_seed, kernel, iterations=1)

        trimap = np.full(mask.shape, 0.5, dtype=np.float32)
        trimap[eroded_bg > 0] = 0.0
        trimap[eroded_fg > 0] = 1.0

        return trimap

    @staticmethod
    def solve_alpha_matting(
        img_rgb: np.ndarray,
        trimap: np.ndarray,
        method: str = "cf",
        max_matting_dim: int = 1600
    ) -> np.ndarray:
        if img_rgb.dtype == np.uint8:
            img_norm = img_rgb.astype(np.float64) / 255.0
        else:
            img_norm = img_rgb.astype(np.float64)

        trimap_norm = trimap.astype(np.float64)

        unknown_indices = np.where(np.isclose(trimap_norm, 0.5, atol=0.1))
        if len(unknown_indices[0]) == 0:
            return (trimap_norm > 0.5).astype(np.float32)

        ymin, ymax = np.min(unknown_indices[0]), np.max(unknown_indices[0])
        xmin, xmax = np.min(unknown_indices[1]), np.max(unknown_indices[1])

        h, w = trimap.shape[:2]
        pad = 25
        y1 = max(0, ymin - pad)
        y2 = min(h, ymax + pad)
        x1 = max(0, xmin - pad)
        x2 = min(w, xmax + pad)

        crop_img = img_norm[y1:y2, x1:x2]
        crop_trimap = trimap_norm[y1:y2, x1:x2]
        ch, cw = crop_img.shape[:2]

        scale = 1.0
        max_crop_dim = max(ch, cw)
        if max_crop_dim > max_matting_dim:
            scale = max_matting_dim / float(max_crop_dim)
            sw, sh = max(16, int(cw * scale)), max(16, int(ch * scale))
            proc_img = cv2.resize(crop_img, (sw, sh), interpolation=cv2.INTER_AREA)
            proc_trimap = cv2.resize(crop_trimap, (sw, sh), interpolation=cv2.INTER_NEAREST)
        else:
            proc_img = crop_img
            proc_trimap = crop_trimap

        try:
            if method == "lkm":
                alpha_crop = pymatting.estimate_alpha_lkm(proc_img, proc_trimap)
            elif method == "knn":
                alpha_crop = pymatting.estimate_alpha_knn(proc_img, proc_trimap)
            else:
                alpha_crop = pymatting.estimate_alpha_cf(proc_img, proc_trimap)
        except Exception as e:
            fallback = "cf" if method == "lkm" else "lkm"
            logger.warning(f"Matting solver failed: {e}. Trying {fallback}.")
            try:
                solver = pymatting.estimate_alpha_cf if fallback == "cf" else pymatting.estimate_alpha_lkm
                alpha_crop = solver(proc_img, proc_trimap)
            except Exception as e2:
                logger.error(f"Alpha matting failed completely: {e2}")
                raise MattingError("Alpha matting failed. Try disabling matting or refining the trimap.") from e2

        if alpha_crop.shape != proc_trimap.shape or not np.all(np.isfinite(alpha_crop)):
            raise MattingError("Alpha matting produced an invalid mask. Try disabling matting or refining the trimap.")

        if scale != 1.0:
            alpha_crop = cv2.resize(alpha_crop, (cw, ch), interpolation=cv2.INTER_CUBIC)

        full_alpha = np.copy(trimap_norm)
        full_alpha[y1:y2, x1:x2] = alpha_crop

        full_alpha[trimap_norm == 1.0] = 1.0
        full_alpha[trimap_norm == 0.0] = 0.0

        return np.clip(full_alpha, 0.0, 1.0).astype(np.float32)
