import cv2
import numpy as np
from typing import Tuple, Optional
from PIL import Image

class MaskPostprocessor:
    @staticmethod
    def refine_alpha(
        alpha: np.ndarray,
        shift: int = 0,
        feather: float = 0.0,
        gamma: float = 1.0,
        contrast: float = 1.0
    ) -> np.ndarray:
        result = alpha.astype(np.float32).copy()

        if shift != 0:
            ksize = abs(shift) * 2 + 1
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize, ksize))
            if shift < 0:
                result = cv2.erode(result, kernel, iterations=1)
            else:
                result = cv2.dilate(result, kernel, iterations=1)

        if feather > 0.1:
            ksize = int(feather * 3) * 2 + 1
            blurred = cv2.GaussianBlur(result, (ksize, ksize), feather)
            edge_zone = (result > 0.01) & (result < 0.99)
            result[edge_zone] = blurred[edge_zone]

        if gamma != 1.0 and gamma > 0.01:
            result = np.power(np.clip(result, 0.0, 1.0), 1.0 / gamma)

        if contrast != 1.0:
            result = (result - 0.5) * contrast + 0.5

        return np.clip(result, 0.0, 1.0)

    @staticmethod
    def create_rgba_cutout(img_rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
        h, w = img_rgb.shape[:2]
        alpha_u8 = (np.clip(alpha, 0.0, 1.0) * 255.0).astype(np.uint8)

        if alpha_u8.ndim == 3:
            alpha_u8 = alpha_u8.squeeze()

        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[..., :3] = img_rgb
        rgba[..., 3] = alpha_u8
        return rgba

    @staticmethod
    def composite_on_background(
        img_rgb: np.ndarray,
        alpha: np.ndarray,
        bg_rgb: Tuple[int, int, int] = (255, 255, 255)
    ) -> np.ndarray:
        alpha_3d = np.repeat(np.clip(alpha, 0.0, 1.0)[..., np.newaxis], 3, axis=2)
        bg_arr = np.array(bg_rgb, dtype=np.float32)

        composited = img_rgb.astype(np.float32) * alpha_3d + bg_arr * (1.0 - alpha_3d)
        return np.clip(composited, 0, 255).astype(np.uint8)

    @staticmethod
    def composite_on_image(
        img_rgb: np.ndarray,
        alpha: np.ndarray,
        bg_img_rgb: np.ndarray
    ) -> np.ndarray:
        h, w = img_rgb.shape[:2]
        bg_resized = cv2.resize(bg_img_rgb, (w, h), interpolation=cv2.INTER_LINEAR)

        alpha_3d = np.repeat(np.clip(alpha, 0.0, 1.0)[..., np.newaxis], 3, axis=2)
        composited = img_rgb.astype(np.float32) * alpha_3d + bg_resized.astype(np.float32) * (1.0 - alpha_3d)
        return np.clip(composited, 0, 255).astype(np.uint8)

    @staticmethod
    def visualize_trimap(trimap: np.ndarray) -> np.ndarray:
        h, w = trimap.shape[:2]
        vis = np.zeros((h, w, 3), dtype=np.uint8)

        fg = trimap > 0.8
        bg = trimap < 0.2
        unknown = (trimap >= 0.2) & (trimap <= 0.8)

        vis[fg] = [34, 197, 94]
        vis[bg] = [30, 41, 59]
        vis[unknown] = [234, 179, 8]

        return vis
