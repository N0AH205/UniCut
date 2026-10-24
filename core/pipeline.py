import time
import cv2
import numpy as np
from typing import Dict, Any, Optional, Tuple
from PIL import Image

from core.model_manager import model_manager, MODEL_REGISTRY
from core.preprocessor import ImagePreprocessor
from core.matting_engine import MattingEngine
from core.despill import ColorDespill
from core.postprocessor import MaskPostprocessor

class BackgroundRemovalPipeline:
    def __init__(self):
        self.model_manager = model_manager

    def process(
        self,
        img_rgb: np.ndarray,
        model_name: str = "birefnet-lite",
        enable_matting: bool = True,
        matting_method: str = "lkm",
        trimap_radius: int = 12,
        enable_tiling: bool = False,
        tile_size: int = 1024,
        despill_mode: str = "auto",
        despill_strength: float = 0.8,
        edge_shift: int = 0,
        edge_feather: float = 0.0,
        gamma: float = 1.0,
        contrast: float = 1.0
    ) -> Dict[str, Any]:
        metrics = {}
        total_start = time.time()
        orig_h, orig_w = img_rgb.shape[:2]

        stage1_start = time.time()
        model_cfg = self.model_manager.get_model_info(model_name)

        if enable_tiling and (orig_h > 1024 or orig_w > 1024):
            tiles = ImagePreprocessor.generate_tiles(img_rgb, tile_size=tile_size, overlap=256)
            tile_masks = []
            for tile in tiles:
                tensor = ImagePreprocessor.prepare_tensor(
                    tile["crop"],
                    target_size=(1024, 1024),
                    mean=model_cfg["mean"],
                    std=model_cfg["std"]
                )
                pred = self.model_manager.run_inference(model_name, tensor)
                pred_2d = ImagePreprocessor.resize_mask(pred, (tile_size, tile_size))
                tile_masks.append(pred_2d)

            base_mask = ImagePreprocessor.blend_tiles(tiles, tile_masks, (orig_h, orig_w))
        else:
            tensor = ImagePreprocessor.prepare_tensor(
                img_rgb,
                target_size=model_cfg["input_size"],
                mean=model_cfg["mean"],
                std=model_cfg["std"]
            )
            raw_mask = self.model_manager.run_inference(model_name, tensor)
            base_mask = ImagePreprocessor.resize_mask(raw_mask, (orig_h, orig_w))

        metrics["base_inference_ms"] = round((time.time() - stage1_start) * 1000, 1)

        stage2_start = time.time()
        trimap = MattingEngine.generate_trimap(base_mask, radius=trimap_radius)
        trimap_vis = MaskPostprocessor.visualize_trimap(trimap)
        metrics["trimap_ms"] = round((time.time() - stage2_start) * 1000, 1)

        stage3_start = time.time()
        if enable_matting:
            alpha = MattingEngine.solve_alpha_matting(
                img_rgb,
                trimap,
                method=matting_method
            )
        else:
            alpha = base_mask.copy()
        metrics["alpha_matting_ms"] = round((time.time() - stage3_start) * 1000, 1)

        stage4_start = time.time()
        refined_alpha = MaskPostprocessor.refine_alpha(
            alpha,
            shift=edge_shift,
            feather=edge_feather,
            gamma=gamma,
            contrast=contrast
        )
        metrics["post_refine_ms"] = round((time.time() - stage4_start) * 1000, 1)

        stage5_start = time.time()
        despilled_rgb = ColorDespill.apply_despill(
            img_rgb,
            refined_alpha,
            mode=despill_mode,
            strength=despill_strength
        )
        metrics["despill_ms"] = round((time.time() - stage5_start) * 1000, 1)

        rgba_cutout = MaskPostprocessor.create_rgba_cutout(despilled_rgb, refined_alpha)

        metrics["total_ms"] = round((time.time() - total_start) * 1000, 1)

        return {
            "rgba_cutout": rgba_cutout,
            "alpha_mask": refined_alpha,
            "base_alpha": alpha,
            "trimap": trimap,
            "trimap_vis": trimap_vis,
            "despilled_rgb": despilled_rgb,
            "metrics": metrics
        }

pipeline = BackgroundRemovalPipeline()
