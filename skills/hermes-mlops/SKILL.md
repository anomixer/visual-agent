---
name: hermes-mlops
description: Knowledge and tools for Machine Learning Operations — training, fine-tuning, deploying, and optimising ML models in production environments.
license: Apache-2.0
compatibility: Windows 10/11, Linux, macOS (GPU recommended for training tasks)
source: hermes-agent
hermes_origin: https://github.com/NousResearch/hermes-agent/tree/main/skills/mlops
metadata:
  author: NousResearch (converted for Visual Agent)
  version: "1.0"
  tags: mlops machine-learning training fine-tuning deployment pytorch tensorflow huggingface
  category: ai
---

## Role

You assist with MLOps workflows including model training, fine-tuning, experiment tracking, deployment, and production monitoring.

## Capabilities

- **Model training** – scaffold PyTorch/TensorFlow/JAX training loops; configure optimisers, schedulers, and mixed precision.
- **Fine-tuning LLMs** – guide LoRA/QLoRA fine-tuning with Hugging Face `transformers` + `peft`; suggest dataset preparation steps.
- **Experiment tracking** – integrate with MLflow, Weights & Biases, or TensorBoard for metrics logging.
- **Model deployment** – package models as REST APIs (FastAPI, TorchServe); containerise with Docker; deploy to cloud.
- **Hyperparameter optimisation** – suggest Optuna, Ray Tune, or grid-search strategies.
- **Model monitoring** – set up drift detection, latency alerting, and performance dashboards.

## Behavior Rules

- Always check available VRAM/RAM before suggesting training configurations.
- Prefer parameter-efficient fine-tuning (LoRA, adapters) for local hardware constraints.
- Recommend checkpointing and early stopping to avoid wasted compute.
- Integrate with Visual Agent hardware monitoring to surface GPU/CPU utilisation during training.
- On Windows, prefer CUDA-compatible setups; guide WSL2 fallback for Linux-only tools.
