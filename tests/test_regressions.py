import ast
import asyncio
import importlib.util
import logging
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np
from fastapi import HTTPException
from PIL import UnidentifiedImageError
import binascii

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('matting_under_test', ROOT / 'core/matting_engine.py')
matting = importlib.util.module_from_spec(spec)
solvers = types.ModuleType('pymatting')
with patch.dict(sys.modules, pymatting=solvers):
    spec.loader.exec_module(matting)


def run_immediate(coro):
    try:
        coro.send(None)
    except StopIteration as result:
        return result.value
    finally:
        coro.close()


def route(name, **overrides):
    tree = ast.parse((ROOT / 'server.py').read_text(encoding='utf-8'))
    fn = next(n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    fn.decorator_list = []
    fn.args.defaults = [ast.Constant(None) for _ in fn.args.defaults]
    ns = dict(HTTPException=HTTPException, MattingError=matting.MattingError,
              UnidentifiedImageError=UnidentifiedImageError, binascii=binascii,
              logger=Mock(), time=types.SimpleNamespace(time=lambda: 0))
    ns.update(overrides)
    module = ast.parse('from __future__ import annotations')
    module.body.append(fn)
    exec(compile(ast.fix_missing_locations(module), 'server.py', 'exec'), ns)
    return ns[name]


interactive_spec = importlib.util.spec_from_file_location('interactive_under_test', ROOT / 'core/interactive.py')
interactive = importlib.util.module_from_spec(interactive_spec)
with patch.dict(sys.modules, {'core': types.ModuleType('core'), 'core.matting_engine': matting}):
    interactive_spec.loader.exec_module(interactive)


model_spec = importlib.util.spec_from_file_location('models_under_test', ROOT / 'core/model_manager.py')
models = importlib.util.module_from_spec(model_spec)
model_spec.loader.exec_module(models)


class ModelSelectionTests(unittest.TestCase):
    def test_only_birefnet_is_registered(self):
        self.assertEqual(list(models.MODEL_REGISTRY), ['birefnet-lite'])
        self.assertEqual(models.model_manager.get_model_info()['repo_id'], 'onnx-community/BiRefNet_lite-ONNX')
        self.assertEqual([item['id'] for item in models.model_manager.list_models()['models']], ['birefnet-lite'])

    def test_unsupported_models_never_download(self):
        with patch.object(models, 'hf_hub_download') as download:
            with self.assertRaises(ValueError):
                models.model_manager.load_session('removed-model')
            with self.assertRaises(ValueError):
                models.model_manager.get_model_info('removed-model')
            download.assert_not_called()

    def test_api_rejects_unsupported_model(self):
        decoder = Mock(return_value=np.zeros((8, 8, 3), dtype=np.uint8))
        with self.assertRaises(HTTPException) as ctx:
            run_immediate(route('process_image', base64_to_image=decoder,
                                MODEL_REGISTRY=models.MODEL_REGISTRY)(
                file=None, sample_id=None, image_base64='test', model_name='removed-model'))
        self.assertEqual(ctx.exception.status_code, 422)

    def test_api_and_pipeline_default_to_birefnet(self):
        for filename, function_name in [('server.py', 'process_image'), ('core/pipeline.py', 'process')]:
            tree = ast.parse((ROOT / filename).read_text(encoding='utf-8'))
            fn = next(node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function_name)
            defaults = dict(zip([arg.arg for arg in fn.args.args][-len(fn.args.defaults):], fn.args.defaults))
            value = defaults['model_name']
            if isinstance(value, ast.Call):
                value = value.args[0]
            self.assertEqual(ast.literal_eval(value), 'birefnet-lite')


class InteractiveTests(unittest.TestCase):
    def test_grabcut_failure_is_explicit(self):
        with patch.object(cv2, 'grabCut', side_effect=cv2.error('missing seeds')):
            with self.assertRaises(matting.MattingError):
                interactive.InteractiveRefiner.refine_with_points(
                    np.zeros((32,32,3), dtype=np.uint8), np.full((32,32), 0.4), [{'x':16,'y':16}], [])

    def test_point_edit_preserves_unchanged_soft_alpha(self):
        image = np.zeros((40,40,3), dtype=np.uint8)
        base = np.full((40,40), 0.3, dtype=np.float32)
        def segment(img, mask, *args, **kwargs):
            mask[:] = cv2.GC_PR_BGD
            mask[15:25,15:25] = cv2.GC_FGD
        with patch.object(cv2, 'grabCut', side_effect=segment), patch.object(matting.MattingEngine, 'solve_alpha_matting', return_value=np.full((40,40), 0.8)):
            result = interactive.InteractiveRefiner.refine_with_points(image, base, [{'x':20,'y':20}], [])
        self.assertEqual(result[0,0], base[0,0])
        self.assertEqual(float(result[20,20]), 1.0)
        self.assertAlmostEqual(float(result[14,14]), 0.8)

    def test_no_classification_change_preserves_soft_alpha(self):
        base = np.full((32,32), 0.7, dtype=np.float32)
        with patch.object(cv2, 'grabCut'):
            result = interactive.InteractiveRefiner.refine_with_points(
                np.zeros((32,32,3), dtype=np.uint8), base, [{'x':16,'y':16}], [])
        self.assertEqual(result[0,0], base[0,0])
        self.assertEqual(result[16,16], 1.0)

    def test_confident_model_pixels_are_not_locked_inside_point_region(self):
        image = np.zeros((40,40,3), dtype=np.uint8)
        base = np.ones((40,40), dtype=np.float32)
        base[:, :8] = 0
        def segment(img, mask, *args, **kwargs):
            self.assertEqual(mask[15,25], cv2.GC_PR_FGD)
            self.assertEqual(mask[0,25], cv2.GC_FGD)
            self.assertEqual(mask[20,20], cv2.GC_BGD)
        with patch.object(cv2, 'grabCut', side_effect=segment), patch.object(matting.MattingEngine, 'solve_alpha_matting', return_value=base):
            result = interactive.InteractiveRefiner.refine_with_points(image, base, [], [{'x':20,'y':20}], point_radius=2)
        self.assertEqual(result[20,20], 0)

    def test_keep_and_erase_brushes_are_exact_without_matting(self):
        image = np.zeros((16,16,3), dtype=np.uint8)
        base = np.full((16,16), 0.37, dtype=np.float32)
        strokes = np.zeros((16,16,4), dtype=np.uint8)
        strokes[3:5,3:5] = [34,197,94,217]
        strokes[8:10,8:10] = [239,68,68,217]
        with patch.object(matting.MattingEngine, 'solve_alpha_matting') as solve:
            result = interactive.InteractiveRefiner.refine_with_strokes(image, base, strokes)
            solve.assert_not_called()
        self.assertTrue(np.all(result[3:5,3:5] == 1))
        self.assertTrue(np.all(result[8:10,8:10] == 0))
        self.assertEqual(result[0,0], base[0,0])

    def test_hair_brush_uses_native_patches_and_preserves_unpainted_alpha(self):
        image = np.zeros((1800,32,3), dtype=np.uint8)
        base = np.zeros((1800,32), dtype=np.float32)
        base[:,:16] = 1
        base[0,0] = 0.73
        strokes = np.zeros((1800,32,4), dtype=np.uint8)
        strokes[8:1792,14:18] = [234,179,8,217]
        def solve(crop, trimap, **kwargs):
            self.assertEqual(kwargs['max_matting_dim'], max(crop.shape[:2]))
            self.assertLessEqual(max(crop.shape[:2]), 640)
            return np.full(trimap.shape, 0.42, dtype=np.float32)
        with patch.object(matting.MattingEngine, 'solve_alpha_matting', side_effect=solve) as solver:
            result = interactive.InteractiveRefiner.refine_with_strokes(image, base, strokes)
        self.assertEqual(solver.call_count, 4)
        selected = strokes[...,3] > 30
        np.testing.assert_array_equal(result[~selected], base[~selected])
        np.testing.assert_allclose(result[selected], 0.42)

    def test_matte_brush_requires_anchors(self):
        image = np.zeros((16,16,3), dtype=np.uint8)
        base = np.full((16,16), 0.5, dtype=np.float32)
        strokes = np.zeros((16,16,4), dtype=np.uint8)
        strokes[8,8] = [234,179,8,217]
        with self.assertRaisesRegex(matting.MattingError, 'Add Keep and Erase'):
            interactive.InteractiveRefiner.refine_with_strokes(image, base, strokes)

    def test_brush_dimensions_are_checked(self):
        with self.assertRaises(matting.MattingError):
            interactive.InteractiveRefiner.refine_with_strokes(np.zeros((8,8,3)), np.zeros((8,8)), np.zeros((4,4,4)))

    def test_trimap_shape_is_checked(self):
        with self.assertRaises(matting.MattingError):
            interactive.InteractiveRefiner.refine_with_trimap(np.zeros((8,8,3)), np.zeros((4,4)))

    def test_point_coordinates_must_be_in_image(self):
        with self.assertRaises(matting.MattingError):
            interactive.InteractiveRefiner.refine_with_points(
                np.zeros((8,8,3)), np.zeros((8,8)), [{'x':-1,'y':4}], [])


class RegressionTests(unittest.TestCase):
    def test_uncertain_pixels_remain_unknown(self):
        mask = np.full((32, 32), 0.7, dtype=np.float32)
        np.testing.assert_array_equal(matting.MattingEngine.generate_trimap(mask), 0.5)

    def test_confident_regions_and_unknown_boundary(self):
        mask = np.zeros((32, 32), dtype=np.float32)
        mask[8:24, 8:24] = 1
        trimap = matting.MattingEngine.generate_trimap(mask, radius=2)
        self.assertEqual(trimap[0, 0], 0)
        self.assertEqual(trimap[16, 16], 1)
        self.assertEqual(trimap[8, 8], 0.5)

    def test_solver_failure_is_explicit(self):
        with patch.object(solvers, 'estimate_alpha_cf', Mock(side_effect=ValueError('primary')), create=True), patch.object(solvers, 'estimate_alpha_lkm', Mock(side_effect=ValueError('fallback')), create=True):
            with self.assertRaises(matting.MattingError):
                matting.MattingEngine.solve_alpha_matting(np.zeros((8,8,3), dtype=np.uint8), np.full((8,8), 0.5))

    def test_successful_fallback_returns_alpha(self):
        with patch.object(solvers, 'estimate_alpha_cf', Mock(side_effect=ValueError('primary')), create=True), patch.object(solvers, 'estimate_alpha_lkm', Mock(return_value=np.full((8,8), 0.6)), create=True):
            alpha = matting.MattingEngine.solve_alpha_matting(np.zeros((8,8,3), dtype=np.uint8), np.full((8,8), 0.5))
            np.testing.assert_allclose(alpha, 0.6)

    def test_lkm_failure_tries_closed_form(self):
        with patch.object(solvers, 'estimate_alpha_lkm', Mock(side_effect=ValueError('crop too small')), create=True), patch.object(solvers, 'estimate_alpha_cf', Mock(return_value=np.full((8,8), 0.6)), create=True) as closed_form:
            alpha = matting.MattingEngine.solve_alpha_matting(np.zeros((8,8,3), dtype=np.uint8), np.full((8,8), 0.5), method='lkm')
            closed_form.assert_called_once()
            np.testing.assert_allclose(alpha, 0.6)

    def test_missing_upload_remains_400(self):
        with self.assertRaises(HTTPException) as ctx:
            run_immediate(route('process_image')(file=None, sample_id=None, image_base64=None))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_missing_edit_data_remains_400(self):
        for name in ('interactive_refine', 'remat_trimap', 'adjust_post'):
            with self.subTest(name=name), self.assertRaises(HTTPException) as ctx:
                route(name)(types.SimpleNamespace(image_id=None, image_base64=None))
            self.assertEqual(ctx.exception.status_code, 400)

    def test_matting_error_reaches_client(self):
        decoder = Mock(side_effect=matting.MattingError('Alpha matting failed.'))
        with self.assertRaises(HTTPException) as ctx:
            run_immediate(route('process_image', base64_to_image=decoder)(file=None, sample_id=None, image_base64='test'))
        self.assertEqual(ctx.exception.status_code, 422)

    def test_internal_error_is_sanitized(self):
        decoder = Mock(side_effect=RuntimeError('private/server/path'))
        with self.assertRaises(HTTPException) as ctx:
            run_immediate(route('process_image', base64_to_image=decoder)(file=None, sample_id=None, image_base64='test'))
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertNotIn('private', ctx.exception.detail)

    def test_batch_load_clears_previous_session(self):
        source = (ROOT / 'static/js/app.js').read_text(encoding='utf-8')
        body = source.split('function loadBatchItemIntoStudio(item) {', 1)[1].split('function ', 1)[0]
        self.assertLess(body.index('currentImageId = null'), body.index('studio.loadImages'))


if __name__ == '__main__':
    unittest.main()
