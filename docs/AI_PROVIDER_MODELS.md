# AI Provider Models Reference

> **Last Updated**: 2026-04-08

## Overview

This document catalogues all LLM providers, models, token limits, and pricing supported by AgentPilot. The source-of-truth code files are [`lib/ai/context-limits.ts`](/lib/ai/context-limits.ts) and [`lib/ai/pricing.ts`](/lib/ai/pricing.ts). All LLM calls go through the [`ProviderFactory`](/lib/ai/providerFactory.ts) — never call provider SDKs directly.

---

## Supported Providers

| Provider | Key | Env Variable | Console |
|----------|-----|-------------|---------|
| OpenAI | `openai` | `OPENAI_API_KEY` | https://platform.openai.com |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| Kimi (Moonshot AI) | `kimi` | `KIMI_API_KEY` | https://platform.kimi.ai |

---

## OpenAI Models

### GPT-5.4 Series (Latest — March 2026)

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `gpt-5.4` | 1,050,000 | 128,000 | $2.50 | $15.00 | Flagship. Long context (>272K) priced at 2x input, 1.5x output |
| `gpt-5.4-mini` | 400,000 | 128,000 | $0.75 | $4.50 | Best mini for coding, computer use, subagents |
| `gpt-5.4-nano` | 400,000 | 128,000 | $0.20 | $1.25 | Fastest/cheapest — classification, extraction, ranking |
| `gpt-5.4-pro` | 1,050,000 | 128,000 | $30.00 | $180.00 | Highest quality reasoning (Responses API only) |

### GPT-5.2 Series (Previous frontier)

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `gpt-5.2` | 400,000 | 128,000 | $1.75 | $14.00 | Previous frontier, recommend GPT-5.4 |

### GPT-5.1 Series

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `gpt-5.1` | 400,000 | 128,000 | $1.25 | $10.00 | Coding & agentic tasks, configurable reasoning |

### GPT-5 Series

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `gpt-5` | 400,000 | 128,000 | $1.25 | $10.00 | Previous generation |
| `gpt-5-mini` | 400,000 | 128,000 | $0.25 | $2.00 | Cost-efficient for high volume |
| `gpt-5-nano` | 400,000 | 128,000 | $0.05 | $0.40 | Fastest/cheapest GPT-5 variant |

### GPT-4.1 Series

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `gpt-4.1` | 1,047,576 | 32,768 | $2.00 | $8.00 | ~1M context |
| `gpt-4.1-mini` | 1,047,576 | 32,768 | $0.40 | $1.60 | Fast, excellent tool calling |
| `gpt-4.1-nano` | 1,047,576 | 32,768 | $0.10 | $0.40 | Most economical 1M-context model |

### o-Series (Reasoning)

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `o3` | 200,000 | 100,000 | $2.00 | $8.00 | Strong reasoning |
| `o3-pro` | 200,000 | 100,000 | $20.00 | $80.00 | Premium reasoning |
| `o4-mini` | 200,000 | 100,000 | $1.10 | $4.40 | Efficient reasoning, strong in code & vision |

### GPT-4o Series (Legacy)

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `gpt-4o` | 128,000 | 16,384 | $2.50 | $10.00 | Previous generation |
| `gpt-4o-mini` | 128,000 | 16,384 | $0.15 | $0.60 | Previous mini |

---

## Anthropic Claude Models

### Claude 4.6 Series (Latest — Feb 2026)

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `claude-opus-4-6` | 1,000,000 | 128,000 | $5.00 | $25.00 | Most intelligent. Extended/adaptive thinking. Batch: up to 300K output |
| `claude-sonnet-4-6` | 1,000,000 | 64,000 | $3.00 | $15.00 | Best speed/intelligence balance. Batch: up to 300K output |

### Claude 4.5 Series

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `claude-opus-4-5-20251101` | 200,000 | 64,000 | $5.00 | $25.00 | Legacy — prefer Opus 4.6 |
| `claude-sonnet-4-5-20250929` | 200,000 | 64,000 | $3.00 | $15.00 | Legacy — prefer Sonnet 4.6 |
| `claude-haiku-4-5-20251001` | 200,000 | 64,000 | $1.00 | $5.00 | Fastest model, near-frontier intelligence |

### Claude 4.1 Series

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `claude-opus-4-1-20250805` | 200,000 | 32,000 | $15.00 | $75.00 | Legacy |

### Claude 4 Series

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `claude-sonnet-4-20250514` | 200,000 | 64,000 | $3.00 | $15.00 | Legacy |
| `claude-opus-4-20250514` | 200,000 | 32,000 | $15.00 | $75.00 | Legacy |

### Claude 3.5 Series (Legacy)

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `claude-3-5-sonnet-20241022` | 200,000 | 8,192 | $3.00 | $15.00 | Legacy |
| `claude-3-5-haiku-20241022` | 200,000 | 8,192 | $0.80 | $4.00 | Legacy |

### Claude 3 Series (Deprecated)

| Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|----------|---------------|------------|-----------|------------|-------|
| `claude-3-opus-20240229` | 200,000 | 4,096 | $15.00 | $75.00 | Deprecated |
| `claude-3-sonnet-20240229` | 200,000 | 4,096 | $3.00 | $15.00 | Deprecated |
| `claude-3-haiku-20240307` | 200,000 | 4,096 | $0.25 | $1.25 | Retiring April 19, 2026 |

---

## Kimi (Moonshot AI) Models

### Kimi K2.5 Series (Latest — Jan 2026)

| Model ID | Context Window | Max Output | Input $/1M (miss) | Input $/1M (hit) | Output $/1M | Notes |
|----------|---------------|------------|-------------------|------------------|------------|-------|
| `kimi-k2.5` | 262,144 | 32,768 | $0.60 | $0.10 | $3.00 | Multimodal (text+vision), thinking modes |

### Kimi K2 Series

| Model ID | Context Window | Max Output | Input $/1M (miss) | Input $/1M (hit) | Output $/1M | Notes |
|----------|---------------|------------|-------------------|------------------|------------|-------|
| `kimi-k2-0905-preview` | 262,144 | 16,384 | $0.60 | $0.15 | $2.50 | Base MoE model (1T params, 32B active) |
| `kimi-k2-0711-preview` | 131,072 | 8,192 | $0.60 | $0.15 | $2.50 | Earlier preview |
| `kimi-k2-turbo-preview` | 262,144 | 16,384 | $1.15 | $0.15 | $8.00 | Higher quality, higher cost |
| `kimi-k2-thinking` | 262,144 | 32,768 | $0.60 | $0.15 | $2.50 | Enhanced reasoning |
| `kimi-k2-thinking-turbo` | 262,144 | 32,768 | $1.15 | $0.15 | $8.00 | Premium reasoning |

---

## Pricing Notes

- **Batch API**: OpenAI offers batch processing. Anthropic Batch API gives 50% discount on all tokens.
- **Prompt Caching**: All three providers support input caching at reduced rates.
- **Long Context Surcharges**: OpenAI GPT-5.4/5.4-pro charge 2x input + 1.5x output for prompts >272K tokens. Anthropic applies long-context pricing for requests >200K input tokens on 1M-window models.
- **US-only Inference**: Anthropic charges 1.1x for US-only inference on models released after Feb 1, 2026.
- **Extended Thinking**: Anthropic charges thinking tokens at output token rates.

---

## Sources

- [Anthropic Models Overview](https://platform.claude.com/docs/en/docs/about-claude/models/overview)
- [Anthropic Pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
- [OpenAI Models](https://developers.openai.com/api/docs/models)
- [OpenAI Pricing](https://developers.openai.com/api/docs/pricing)
- [Kimi API Platform](https://platform.kimi.ai/docs/pricing/chat)

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-04-08 | Initial creation | Full model catalogue for OpenAI, Anthropic, and Kimi with latest models as of April 2026 |
