import cv2
import numpy as np
import logging
from typing import List, Dict, Any, Tuple
from core.matting_engine import MattingEngine, MattingError

logger = logging.getLogger("UniCut.Interactive")

class InteractiveRefiner:
    @staticmethod
    def refine_with_points(
        img_rgb: np.ndarray,
        base_mask: np.ndarray,
        fg_points: List[Dict[str, int]],
        bg_points: List[Dict[str, int]],
        point_radius: int = 8,
        iterations: int = 3
    ) -> np.ndarray:
        all_pts = fg_points + bg_points
        if not all_pts:
            return base_mask.copy()

        h, w = img_rgb.shape[:2]
        if base_mask.shape != (h, w) or point_radius < 1:
            raise MattingError("Invalid mask dimensions or point radius.")
        valid_pts = [pt for pt in all_pts if 0 <= int(pt["x"]) < w and 0 <= int(pt["y"]) < h]
        xs = [int(pt["x"]) for pt in valid_pts]
        ys = [int(pt["y"]) for pt in valid_pts]

        if not xs or not ys:
            raise MattingError("Place refinement points inside the image.")

        pad = max(point_radius * 6, 80)
        x1 = max(0, min(xs) - pad)
        y1 = max(0, min(ys) - pad)
        x2 = min(w, max(xs) + pad)
        y2 = min(h, max(ys) + pad)

        rw = x2 - x1
        rh = y2 - y1
        use_roi = (rw * rh) < (w * h * 0.85) and rw > 20 and rh > 20

        roi_img = img_rgb[y1:y2, x1:x2] if use_roi else img_rgb
        roi_base = base_mask[y1:y2, x1:x2] if use_roi else base_mask
        curr_h, curr_w = roi_img.shape[:2]

        grab_mask = np.full((curr_h, curr_w), cv2.GC_PR_BGD, dtype=np.uint8)
        grab_mask[roi_base >= 0.5] = cv2.GC_PR_FGD
        # Model confidence is only a guess inside the correction region.
        # Keep boundary context fixed while allowing even confident mistakes to change.
        border = np.zeros((curr_h, curr_w), dtype=bool)
        border[:3] = border[-3:] = True
        border[:, :3] = border[:, -3:] = True
        grab_mask[border & (roi_base > 0.88)] = cv2.GC_FGD
        grab_mask[border & (roi_base < 0.12)] = cv2.GC_BGD

        off_x = x1 if use_roi else 0
        off_y = y1 if use_roi else 0

        prompt_mask = np.zeros((curr_h, curr_w), dtype=np.uint8)
        for pt in fg_points:
            px, py = int(pt["x"]) - off_x, int(pt["y"]) - off_y
            if 0 <= px < curr_w and 0 <= py < curr_h:
                cv2.circle(grab_mask, (px, py), point_radius, cv2.GC_FGD, -1)
                cv2.circle(prompt_mask, (px, py), point_radius, 1, -1)

        for pt in bg_points:
            px, py = int(pt["x"]) - off_x, int(pt["y"]) - off_y
            if 0 <= px < curr_w and 0 <= py < curr_h:
                cv2.circle(grab_mask, (px, py), point_radius, cv2.GC_BGD, -1)
                cv2.circle(prompt_mask, (px, py), point_radius, 2, -1)

        bgd_model = np.zeros((1, 65), np.float64)
        fgd_model = np.zeros((1, 65), np.float64)

        try:
            cv2.grabCut(
                roi_img,
                grab_mask,
                None,
                bgd_model,
                fgd_model,
                iterCount=iterations,
                mode=cv2.GC_INIT_WITH_MASK
            )

            refined_patch = np.where((grab_mask == cv2.GC_FGD) | (grab_mask == cv2.GC_PR_FGD), 1.0, 0.0).astype(np.float32)
            changed = (refined_patch >= 0.5) != (roi_base >= 0.5)
            if np.any(changed):
                # Re-mat changed boundaries without flattening existing hair alpha elsewhere.
                affected = cv2.dilate(changed.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
                trimap = MattingEngine.generate_trimap(refined_patch, radius=2)
                trimap[prompt_mask == 1] = 1.0
                trimap[prompt_mask == 2] = 0.0
                solved = MattingEngine.solve_alpha_matting(roi_img, trimap, method="lkm")
                refined_patch = np.where(affected, solved, roi_base).astype(np.float32)
            else:
                refined_patch = roi_base.copy()
            refined_patch[prompt_mask == 1] = 1.0
            refined_patch[prompt_mask == 2] = 0.0

            if use_roi:
                refined_mask = base_mask.copy()
                refined_mask[y1:y2, x1:x2] = refined_patch
            else:
                refined_mask = refined_patch

            return np.clip(refined_mask, 0.0, 1.0)
        except Exception as e:
            logger.error(f"GrabCut interactive refinement failed: {e}")
            raise MattingError("Point refinement failed. Try adding both keep and remove points.") from e

    @staticmethod
    def refine_with_strokes(
        img_rgb: np.ndarray,
        base_mask: np.ndarray,
        strokes_rgba: np.ndarray,
        method: str = "lkm"
    ) -> np.ndarray:
        h, w = img_rgb.shape[:2]
        if base_mask.shape != (h, w) or strokes_rgba.shape != (h, w, 4):
            raise MattingError("Brush and mask dimensions must match the image.")

        painted = strokes_rgba[..., 3] > 30
        red, green = strokes_rgba[..., 0], strokes_rgba[..., 1]
        keep = painted & (green > 150) & (red < 100)
        erase = painted & (red > 150) & (green < 100)
        unknown = painted & ~(keep | erase)
        corrected = np.clip(base_mask, 0.0, 1.0).astype(np.float32).copy()
        corrected[keep] = 1.0
        corrected[erase] = 0.0
        if not np.any(unknown):
            return corrected

        result = corrected.copy()
        ys, xs = np.where(unknown)
        tile_size, halo = 512, 64
        # Solve small patches at native resolution, writing back only the Matte strokes.
        for y in range((int(ys.min()) // tile_size) * tile_size, int(ys.max()) + 1, tile_size):
            for x in range((int(xs.min()) // tile_size) * tile_size, int(xs.max()) + 1, tile_size):
                y2, x2 = min(h, y + tile_size), min(w, x + tile_size)
                selected = unknown[y:y2, x:x2]
                if not np.any(selected):
                    continue
                cy1, cx1 = max(0, y - halo), max(0, x - halo)
                cy2, cx2 = min(h, y2 + halo), min(w, x2 + halo)
                region = np.s_[cy1:cy2, cx1:cx2]
                trimap = MattingEngine.generate_trimap(corrected[region], radius=2)
                trimap[unknown[region]] = 0.5
                trimap[keep[region]] = 1.0
                trimap[erase[region]] = 0.0
                if not np.any(trimap == 0.0) or not np.any(trimap == 1.0):
                    raise MattingError("Matte brush needs foreground and background nearby. Add Keep and Erase marks beside the hair edge.")
                crop = img_rgb[region]
                solved = MattingEngine.solve_alpha_matting(
                    crop, trimap, method=method, max_matting_dim=max(crop.shape[:2])
                )
                local = solved[y-cy1:y2-cy1, x-cx1:x2-cx1]
                result[y:y2, x:x2][selected] = local[selected]
        return result

    @staticmethod
    def refine_with_trimap(
        img_rgb: np.ndarray,
        user_trimap: np.ndarray,
        method: str = "cf"
    ) -> np.ndarray:
        if user_trimap.shape != img_rgb.shape[:2]:
            raise MattingError("Trimap dimensions must match the image.")
        return MattingEngine.solve_alpha_matting(img_rgb, user_trimap, method=method)
