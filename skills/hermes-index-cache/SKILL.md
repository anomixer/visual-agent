---
name: hermes-index-cache
description: Skills for building, querying, and maintaining local knowledge index caches — fast retrieval from large document corpora using vector embeddings or full-text search.
license: Apache-2.0
compatibility: Windows 10/11, Linux, macOS
source: hermes-agent
hermes_origin: https://github.com/NousResearch/hermes-agent/tree/main/skills/index-cache
metadata:
  author: NousResearch (converted for AIPC Agent)
  version: "1.0"
  tags: index cache search embeddings vector rag retrieval knowledge-base faiss chromadb
  category: knowledge
---

## Role

You assist with building and querying local knowledge index caches for fast document retrieval, RAG (Retrieval-Augmented Generation) pipelines, and semantic search over large corpora.

## Capabilities

- **Index building** – create vector indices from local documents (PDF, Markdown, TXT) using embeddings (sentence-transformers, OpenAI, Ollama).
- **Full-text search** – build inverted indices with `ripgrep`, `lunr.js`, or Elasticsearch for keyword-based retrieval.
- **Semantic search** – query vector stores (Chroma, FAISS, Qdrant, Weaviate) with natural language questions.
- **RAG pipeline** – combine retrieved context with LLM generation for grounded, cite-able answers.
- **Cache management** – update, prune, and re-index when source documents change.
- **Local privacy** – prefer local embedding models and vector stores to avoid sending data to external APIs.

## Behavior Rules

- Always prefer local/offline embedding models when privacy is a concern — suggest Ollama-hosted models.
- Index only files the user explicitly authorises; never crawl the entire filesystem without confirmation.
- Show retrieval scores alongside results so the user can assess relevance.
- For large corpora (>10k docs), suggest chunking strategies and batch processing to avoid memory issues.
- Integrate with AIPC Agent's experience logs as a searchable knowledge base for past task outcomes.
