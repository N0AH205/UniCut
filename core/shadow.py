import cv2
import numpy as np
from typing import Tuple, Optional

class ShadowGenerator:
    @staticmethod
    def generate_drop_shadow(
        alpha: np.ndarray,
        blur: int = 20,
        opacity: float = 0.6,
        offset_x: int = 0,
        offset_y: int = 15
    ) -> np.ndarray:
        h, w = alpha.shape[:2]
        blur = max(1, int(blur))
        opacity = float(np.clip(opacity, 0.0, 1.0))

        M = np.float32([[1, 0, offset_x], [0, 1, offset_y]])
        shifted = cv2.warpAffine(alpha, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

        ksize = blur * 2 + 1
        blurred = cv2.GaussianBlur(shifted, (ksize, ksize), blur * 0.5)

        shadow_mask = np.clip(blurred * opacity, 0.0, 1.0).astype(np.float32)

        shadow_mask = np.clip(shadow_mask * (1.0 - alpha * 0.9), 0.0, 1.0)
        return shadow_mask

    @staticmethod
    def generate_contact_shadow(
        alpha: np.ndarray,
        blur: int = 18,
        opacity: float = 0.65,
        scale_y: float = 0.25,
        shear_x: float = 0.0
    ) -> np.ndarray:
        h, w = alpha.shape[:2]
        blur = max(2, int(blur))
        opacity = float(np.clip(opacity, 0.0, 1.0))
        scale_y = float(np.clip(scale_y, 0.05, 0.6))

        ys, xs = np.where(alpha > 0.15)
        if len(ys) == 0:
            return np.zeros((h, w), dtype=np.float32)

        bottom_y = float(np.max(ys))

        M = np.float32([
            [1.0, shear_x, 0.0],
            [0.0, -scale_y, bottom_y * (1.0 + scale_y)]
        ])
        cast_mask = cv2.warpAffine(
            alpha, M, (w, h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=0
        )

        y_coords = np.arange(h, dtype=np.float32).reshape(-1, 1)
        dist = np.maximum(0.0, y_coords - bottom_y)
        max_dist = max(1.0, h - bottom_y)
        gradient = np.clip(1.0 - (dist / (max_dist * 0.7)), 0.0, 1.0)
        cast_shadow = cast_mask * gradient

        k_cast = blur * 2 + 1
        cast_blurred = cv2.GaussianBlur(cast_shadow, (k_cast, k_cast), blur * 0.5)

        contact_zone = np.zeros((h, w), dtype=np.float32)
        contact_band = (ys >= bottom_y - 14)
        if np.any(contact_band):
            c_xs = xs[contact_band]
            x_min, x_max = np.min(c_xs), np.max(c_xs)
            cx = int((x_min + x_max) / 2)
            rx = int(max(8, (x_max - x_min) * 0.52))
            ry = int(max(3, blur * 0.3))
            cy = int(min(h - 1, bottom_y + 2))
            cv2.ellipse(contact_zone, (cx, cy), (rx, ry), 0, 0, 360, 1.0, -1)
            k_occ = max(3, int(blur * 0.5) * 2 + 1)
            contact_zone = cv2.GaussianBlur(contact_zone, (k_occ, k_occ), blur * 0.25)

        combined = np.clip(cast_blurred * 0.7 + contact_zone * 0.85, 0.0, 1.0) * opacity
        combined = np.clip(combined * (1.0 - alpha * 0.9), 0.0, 1.0)
        return combined

    @staticmethod
    def composite_with_shadow(
        fg_rgb: np.ndarray,
        alpha_fg: np.ndarray,
        shadow_mask: np.ndarray,
        shadow_color: Tuple[int, int, int] = (0, 0, 0)
    ) -> np.ndarray:
        h, w = fg_rgb.shape[:2]
        sh_color_arr = np.array(shadow_color, dtype=np.float32)

        alpha_fg_f = np.clip(alpha_fg, 0.0, 1.0)
        shadow_f = np.clip(shadow_mask, 0.0, 1.0)

        out_alpha = alpha_fg_f + shadow_f * (1.0 - alpha_fg_f)
        denom = np.maximum(out_alpha[..., np.newaxis], 1e-6)

        fg_part = fg_rgb.astype(np.float32) * alpha_fg_f[..., np.newaxis]
        sh_part = sh_color_arr * (shadow_f * (1.0 - alpha_fg_f))[..., np.newaxis]
        out_rgb = (fg_part + sh_part) / denom

        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[..., :3] = np.clip(out_rgb, 0, 255).astype(np.uint8)
        rgba[..., 3] = (np.clip(out_alpha, 0.0, 1.0) * 255.0).astype(np.uint8)
        return rgba
