import cv2
import numpy as np
import pymatting
import logging

logger = logging.getLogger("UniCut.Despill")

class ColorDespill:
    @staticmethod
    def apply_despill(
        img_rgb: np.ndarray,
        alpha: np.ndarray,
        mode: str = "auto",
        strength: float = 1.0
    ) -> np.ndarray:
        if mode == "none" or strength <= 0.0:
            return img_rgb.copy()

        strength = float(np.clip(strength, 0.0, 1.0))
        img_float = img_rgb.astype(np.float32) / 255.0

        if mode == "auto":
            mode = ColorDespill.detect_dominant_spill(img_float, alpha)
            logger.info(f"Auto-detected despill mode: {mode}")

        if mode == "green":
            return ColorDespill._despill_green(img_rgb, alpha, strength)
        elif mode == "blue":
            return ColorDespill._despill_blue(img_rgb, alpha, strength)
        elif mode == "ml":
            return ColorDespill._despill_ml(img_float, alpha, strength)
        elif mode == "ambient":
            return ColorDespill._despill_ambient(img_rgb, alpha, strength)
        else:
            return img_rgb.copy()

    @staticmethod
    def detect_dominant_spill(img_float: np.ndarray, alpha: np.ndarray) -> str:
        bg_mask = alpha < 0.1
        if not np.any(bg_mask):
            return "none"

        r_mean = np.mean(img_float[..., 0][bg_mask])
        g_mean = np.mean(img_float[..., 1][bg_mask])
        b_mean = np.mean(img_float[..., 2][bg_mask])

        if g_mean > 0.4 and g_mean > (r_mean + b_mean) * 0.7:
            return "green"
        if b_mean > 0.4 and b_mean > (r_mean + g_mean) * 0.7:
            return "blue"

        return "ambient"

    @staticmethod
    def _despill_green(img_rgb: np.ndarray, alpha: np.ndarray, strength: float) -> np.ndarray:
        result = img_rgb.astype(np.float32).copy()
        r = result[..., 0]
        g = result[..., 1]
        b = result[..., 2]

        edge_zone = (alpha > 0.02) & (alpha < 0.98)
        max_allowed_g = (r + b) * 0.5
        spill = np.maximum(0.0, g - max_allowed_g)

        g[edge_zone] = g[edge_zone] - spill[edge_zone] * strength
        result[..., 1] = g

        return np.clip(result, 0, 255).astype(np.uint8)

    @staticmethod
    def _despill_blue(img_rgb: np.ndarray, alpha: np.ndarray, strength: float) -> np.ndarray:
        result = img_rgb.astype(np.float32).copy()
        r = result[..., 0]
        g = result[..., 1]
        b = result[..., 2]

        edge_zone = (alpha > 0.02) & (alpha < 0.98)
        max_allowed_b = (r + g) * 0.5
        spill = np.maximum(0.0, b - max_allowed_b)

        b[edge_zone] = b[edge_zone] - spill[edge_zone] * strength
        result[..., 2] = b

        return np.clip(result, 0, 255).astype(np.uint8)

    @staticmethod
    def _despill_ambient(img_rgb: np.ndarray, alpha: np.ndarray, strength: float) -> np.ndarray:
        h, w = alpha.shape
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))

        dilated = cv2.dilate((alpha > 0.5).astype(np.uint8), kernel)
        bg_ring = (dilated > 0) & (alpha < 0.15)

        if not np.any(bg_ring):
            return img_rgb.copy()

        bg_color = np.median(img_rgb[bg_ring], axis=0)

        result = img_rgb.astype(np.float32).copy()
        edge_zone = (alpha > 0.05) & (alpha < 0.92)

        for c in range(3):
            ch = result[..., c]
            bias = (1.0 - alpha) * bg_color[c] * strength * 0.5
            ch[edge_zone] = np.maximum(0.0, ch[edge_zone] - bias[edge_zone])
            result[..., c] = ch

        return np.clip(result, 0, 255).astype(np.uint8)

    @staticmethod
    def _despill_ml(img_float: np.ndarray, alpha: np.ndarray, strength: float) -> np.ndarray:
        try:
            fg_indices = np.where(alpha > 0.02)
            if len(fg_indices[0]) == 0:
                return (img_float * 255).astype(np.uint8)

            ymin, ymax = np.min(fg_indices[0]), np.max(fg_indices[0])
            xmin, xmax = np.min(fg_indices[1]), np.max(fg_indices[1])

            crop_img = img_float[ymin:ymax+1, xmin:xmax+1]
            crop_alpha = alpha[ymin:ymax+1, xmin:xmax+1].astype(np.float64)

            fg_est = pymatting.estimate_foreground_ml(crop_img, crop_alpha)

            blended_crop = (1.0 - strength) * crop_img + strength * fg_est

            result = img_float.copy()
            result[ymin:ymax+1, xmin:xmax+1] = blended_crop
            return np.clip(result * 255.0, 0, 255).astype(np.uint8)
        except Exception as e:
            logger.warning(f"PyMatting ML foreground estimation failed: {e}. Falling back to ambient.")
            return ColorDespill._despill_ambient((img_float * 255).astype(np.uint8), alpha, strength)
