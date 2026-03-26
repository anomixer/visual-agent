# AI PC Agent Skill File v1

# AI PC Agent: Ollama Setup and Model Readiness Skill (ollama)

## Description
Use this skill when the user needs a local LLM runtime through Ollama, model download help, or diagnosis for Ollama readiness.

## When to Use
1. Ollama is missing, offline, or not responding.
2. The user wants to download or switch a local model.
3. The UI shows that AI is unavailable or the model is not ready.

## Core Rules
1. Prefer the existing Ollama SOPs before inventing a new flow.
2. Separate runtime setup from model download in explanations.
3. If the user only wants diagnosis, explain the status before proposing actions.
4. Use `[ACTION:ADD_TASK ...]` or `[ACTION:EXECUTE_TASK ...]` only after consent.