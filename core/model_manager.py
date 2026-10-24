import os
import time
import logging
from typing import Dict, Any, Optional
import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download

logger = logging.getLogger("UniCut.ModelManager")
logging.basicConfig(level=logging.INFO)

MODEL_REGISTRY = {
    "birefnet-lite": {
        "name": "BiRefNet Lite",
        "license_label": "MIT",
        "repo_id": "onnx-community/BiRefNet_lite-ONNX",
        "filename": "onnx/model.onnx",
        "input_name": "input_image",
        "output_name": "output_image",
        "input_size": (1024, 1024),
        "mean": [0.485, 0.456, 0.406],
        "std": [0.229, 0.224, 0.225],
        "is_logits": True,
        "description": "Bilateral Reference Network Lite. Exceptional for complex boundaries and intricate foregrounds."
    }
}

class ModelManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(ModelManager, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self.sessions: Dict[str, ort.InferenceSession] = {}
        self.available_providers = ort.get_available_providers()
        self.active_providers = self._select_providers()
        self._initialized = True
        logger.info(f"ModelManager initialized. Available providers: {self.available_providers}. Active: {self.active_providers}")

    def _select_providers(self):
        priority = ['TensorrtExecutionProvider', 'CUDAExecutionProvider', 'DmlExecutionProvider', 'CPUExecutionProvider']
        selected = [p for p in priority if p in self.available_providers]
        if not selected:
            selected = ['CPUExecutionProvider']
        return selected

    def get_model_info(self, model_key: str = "birefnet-lite") -> Dict[str, Any]:
        if model_key not in MODEL_REGISTRY:
            raise ValueError(f"Unsupported model: {model_key}")
        return MODEL_REGISTRY[model_key]

    def list_models(self) -> Dict[str, Any]:
        return {
            "models": [
                {
                    "id": k,
                    "name": v["name"],
                    "description": v["description"],
                    "license_label": v["license_label"],
                    "is_loaded": k in self.sessions
                }
                for k, v in MODEL_REGISTRY.items()
            ],
            "active_providers": self.active_providers,
            "all_providers": self.available_providers
        }

    def load_session(self, model_key: str = "birefnet-lite") -> ort.InferenceSession:
        if model_key not in MODEL_REGISTRY:
            raise ValueError(f"Unsupported model: {model_key}")

        if model_key in self.sessions:
            return self.sessions[model_key]

        cfg = MODEL_REGISTRY[model_key]
        logger.info(f"Loading model {model_key} from {cfg['repo_id']}...")

        model_path = hf_hub_download(
            repo_id=cfg["repo_id"],
            filename=cfg["filename"]
        )

        sess_opts = ort.SessionOptions()
        sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        cpu_cores = os.cpu_count() or 4
        sess_opts.intra_op_num_threads = max(1, min(cpu_cores, 8))
        sess_opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL

        session = ort.InferenceSession(
            model_path,
            sess_options=sess_opts,
            providers=self.active_providers
        )

        try:
            dummy = np.zeros((1, 3, cfg["input_size"][0], cfg["input_size"][1]), dtype=np.float32)
            session.run([cfg["output_name"]], {cfg["input_name"]: dummy})
            logger.info(f"Model {model_key} loaded and warmed up.")
        except Exception as e:
            logger.warning(f"Model warmup skipped: {e}")

        self.sessions[model_key] = session
        return session

    def run_inference(self, model_key: str, input_tensor: np.ndarray) -> np.ndarray:
        session = self.load_session(model_key)
        cfg = MODEL_REGISTRY[model_key]

        input_name = cfg["input_name"]
        output_name = cfg["output_name"]

        outputs = session.run([output_name], {input_name: input_tensor})
        raw_output = outputs[0]

        if cfg["is_logits"]:
            mask = 1.0 / (1.0 + np.exp(-raw_output))
        else:
            mask = raw_output

        return np.clip(mask, 0.0, 1.0)

model_manager = ModelManager()
