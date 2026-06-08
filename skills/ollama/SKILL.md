---
name: ollama
description: Set up, diagnose, and manage the local Ollama LLM runtime and model downloads. Use when Ollama is missing or offline, a model needs to be downloaded or switched, or the AI shows as unavailable.
license: Proprietary
compatibility: Windows 10/11. Requires winget for Ollama installation; GPU optional for acceleration.
metadata:
  author: anomixer
  version: "1.0"
  tags: ollama llm local-ai model download gemma setup runtime
---

## When to Use

1. Ollama is missing, offline, or not responding on `127.0.0.1:11434`.
2. The user wants to download, switch, or manage a local LLM model.
3. The UI shows AI as unavailable or the selected model is not ready.

## Core Rules

1. **Prefer existing Ollama SOPs** (`install-ollama`, `pull-llm-model`) before inventing custom flows.
2. **Separate runtime diagnosis from model concerns** – explain status clearly before proposing actions.
3. Always use `127.0.0.1` not `localhost` to avoid IPv6 binding issues on Windows.
4. Ollama installs in User mode via winget – no UAC elevation required.

## Workflow

1. Ping `http://127.0.0.1:11434` to check Ollama runtime status.
2. If offline: recommend `install-ollama` SOP or instruct user to start Ollama.
3. If online but model missing: recommend `pull-llm-model` SOP with the desired model tag.
4. If PATH issues: instruct user to use `$env:LOCALAPPDATA\Programs\Ollama\ollama.exe` fallback.
5. Confirm model is loaded before reporting success.

## Action Protocol

- Install Ollama: `[ACTION:ADD_TASK sop_id="install-ollama"]`
- Pull model: `[ACTION:ADD_TASK sop_id="pull-llm-model"]`
- Execute: `[ACTION:EXECUTE_TASK task_id="<id>"]`

## Model Size Reference

| Model | Approx. Download Size |
|---|---|
| gemma4:e2b-it-qat | ~1.1 GB |
| llama3.2:3b | ~2.0 GB |
| mistral:7b | ~4.1 GB |
