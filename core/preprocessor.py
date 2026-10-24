import cv2
import numpy as np
from typing import Tuple, List, Dict, Any
from PIL import Image

class ImagePreprocessor:
    @staticmethod
    def prepare_tensor(
        img_rgb: np.ndarray,
        target_size: Tuple[int, int] = (1024, 1024),
        mean: List[float] = [0.5, 0.5, 0.5],
        std: List[float] = [1.0, 1.0, 1.0]
    ) -> np.ndarray:
        mean_scaled = (float(mean[0]) * 255.0, float(mean[1]) * 255.0, float(mean[2]) * 255.0)
        blob = cv2.dnn.blobFromImage(
            img_rgb,
            scalefactor=1.0 / 255.0,
            size=target_size,
            mean=mean_scaled,
            swapRB=False,
            crop=False
        ).astype(np.float32)
        if std != [1.0, 1.0, 1.0]:
            std_arr = np.array(std, dtype=np.float32).reshape(1, 3, 1, 1)
            blob /= std_arr
        return blob

    @staticmethod
    def resize_mask(mask: np.ndarray, target_shape: Tuple[int, int]) -> np.ndarray:
        orig_h, orig_w = target_shape
        if mask.ndim == 4:
            mask = mask[0, 0]
        elif mask.ndim == 3:
            mask = mask[0]

        resized = cv2.resize(mask, (orig_w, orig_h), interpolation=cv2.INTER_CUBIC)
        return np.clip(resized, 0.0, 1.0)

    @staticmethod
    def generate_tiles(
        img_rgb: np.ndarray,
        tile_size: int = 1024,
        overlap: int = 256
    ) -> List[Dict[str, Any]]:
        h, w = img_rgb.shape[:2]
        stride = tile_size - overlap
        tiles = []

        y_steps = max(1, int(np.ceil((h - overlap) / stride)))
        x_steps = max(1, int(np.ceil((w - overlap) / stride)))

        wy = np.hanning(tile_size)
        wx = np.hanning(tile_size)
        window_2d = np.outer(wy, wx).astype(np.float32)
        window_2d = np.clip(window_2d, 0.05, 1.0)

        for yi in range(y_steps):
            y1 = min(yi * stride, max(0, h - tile_size))
            y2 = min(y1 + tile_size, h)
            actual_th = y2 - y1

            for xi in range(x_steps):
                x1 = min(xi * stride, max(0, w - tile_size))
                x2 = min(x1 + tile_size, w)
                actual_tw = x2 - x1

                tile_crop = img_rgb[y1:y2, x1:x2]

                pad_bottom = tile_size - actual_th
                pad_right = tile_size - actual_tw
                if pad_bottom > 0 or pad_right > 0:
                    padded_crop = cv2.copyMakeBorder(
                        tile_crop, 0, pad_bottom, 0, pad_right, cv2.BORDER_REFLECT_101
                    )
                else:
                    padded_crop = tile_crop

                tiles.append({
                    "crop": padded_crop,
                    "x1": x1, "y1": y1,
                    "x2": x2, "y2": y2,
                    "actual_th": actual_th,
                    "actual_tw": actual_tw,
                    "window": window_2d[:actual_th, :actual_tw]
                })

        return tiles

    @staticmethod
    def blend_tiles(
        tiles: List[Dict[str, Any]],
        tile_masks: List[np.ndarray],
        orig_shape: Tuple[int, int]
    ) -> np.ndarray:
        h, w = orig_shape
        acc_mask = np.zeros((h, w), dtype=np.float32)
        acc_weight = np.zeros((h, w), dtype=np.float32)

        for tile_meta, mask in zip(tiles, tile_masks):
            x1, y1 = tile_meta["x1"], tile_meta["y1"]
            x2, y2 = tile_meta["x2"], tile_meta["y2"]
            ath, atw = tile_meta["actual_th"], tile_meta["actual_tw"]
            win = tile_meta["window"]

            if mask.ndim == 4:
                mask = mask[0, 0]
            elif mask.ndim == 3:
                mask = mask[0]

            crop_mask = mask[:ath, :atw]

            acc_mask[y1:y2, x1:x2] += crop_mask * win
            acc_weight[y1:y2, x1:x2] += win

        acc_weight = np.maximum(acc_weight, 1e-6)
        reconstructed = acc_mask / acc_weight
        return np.clip(reconstructed, 0.0, 1.0)
