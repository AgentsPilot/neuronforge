# ChatGPT Research Plugin Documentation

**Plugin Version**: 1.0.0
**Category**: AI Research
**Last Updated**: 2025-11-30

---

## Overview

AI-powered web research and content analysis using ChatGPT with Google Search. Use for researching topics, analyzing information, searching the web, and answering questions that require current information or web search.

**Important Note**: `research_topic` already provides comprehensive, detailed output - do NOT use `summarize_content` after `research_topic` as it will reduce quality. Use `summarize_content` ONLY for condensing existing external content, not for research results.

**System Plugin**: This is a system-level plugin that uses platform API keys (no user OAuth required).

---

## Research Sources

### API Configuration
| Information | URL | Summary |
|-------------|-----|---------|
| OpenAI API | https://platform.openai.com/docs/api-reference | ChatGPT API for AI-powered analysis and summarization |
| Google Custom Search | https://developers.google.com/custom-search/v1/overview | Web search API for retrieving current information |

### Authentication
| Information | URL | Summary |
|-------------|-----|---------|
| Authentication Type | N/A - Platform Key | Uses platform-managed API keys, no user OAuth required |

---

## High-Level Decisions

- **Authentication**: Platform-managed API keys (no user OAuth flow)
- **System Plugin**: Marked as `isSystem: true` - available to all users automatically
- **Web Search Integration**: Uses Google Custom Search API for current information
- **Token Management**: Tracks OpenAI token usage per request
- **Research Depth Levels**: 4 levels from quick (3 sources) to deep_dive (10 sources)

---

## Actions

### 1. research_topic
**Description**: Research a topic using web search and AI analysis - produces comprehensive, ready-to-use output

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | Internal OpenAI + Google Search |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| topic | string | Yes | The topic, question, or subject to research (3-500 chars) |
| depth | string | No | Research depth: quick (3 sources), standard (5), comprehensive (8), deep_dive (10). Default: standard |
| focus | string | No | Research focus: general, recent, technical, academic, news. Default: general |
| output_format | string | No | Output format: summary (~200 words), detailed (400-600), bullet_points, report (500-800). Default: detailed |
| max_length | number | No | Maximum response length in characters (500-15000). Default: 5000 |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| summary | string | Comprehensive research summary based on analyzed sources |
| key_points | array | Key findings extracted from research |
| sources | array | List of web sources used in research |
| sources[].title | string | Source page title |
| sources[].url | string | Source URL |
| sources[].snippet | string | Brief excerpt from source |
| source_count | integer | Number of sources analyzed |
| research_depth | string | Depth level used |
| focus | string | Research focus used |

---

### 2. summarize_content
**Description**: Summarize provided content using AI - for EXISTING external content only

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | Internal OpenAI |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| content | string | Yes | The content to summarize (50-50000 chars) |
| length | string | No | Summary length: brief (1-2 sentences), standard (1 paragraph), detailed (multiple paragraphs). Default: standard |
| style | string | No | Writing style: professional, casual, technical, academic. Default: professional |
| focus_on | array | No | Specific aspects or keywords to focus on in the summary |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| summary | string | The summarized content |
| original_length | integer | Character count of original content |
| summary_length | integer | Character count of summary |
| style | string | Writing style used |
| length_type | string | Summary length type |
| tokens_used | integer | OpenAI tokens consumed |
| note | string | Optional note if content was already concise |

---

### 3. answer_question
**Description**: Answer questions using AI with optional web research

| Property | Value |
|----------|-------|
| HTTP Method | POST |
| Endpoint | Internal OpenAI + Optional Google Search |

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| question | string | Yes | The question to answer (5-1000 chars) |
| use_web_search | boolean | No | Whether to use web search for current information. Default: true |
| detail_level | string | No | Level of detail: concise, standard, detailed. Default: standard |
| include_sources | boolean | No | Include source citations in the answer. Default: true |

**Response Structure**:
| Field | Type | Description |
|-------|------|-------------|
| answer | string | The AI-generated answer to the question |
| question | string | The original question asked |
| detail_level | string | Detail level used |
| used_web_search | boolean | Whether web search was used |
| sources | array | List of sources used (if include_sources was true) |
| sources[].title | string | Source page title |
| sources[].url | string | Source URL |
| sources[].snippet | string | Brief excerpt from source |
| source_count | integer | Number of sources used |
| tokens_used | integer | OpenAI tokens consumed |

---

## Generated Files

| File Path | Description |
|-----------|-------------|
| `lib/plugins/definitions/chatgpt-research-plugin-v2.json` | Plugin definition with actions and schemas |
| `lib/server/chatgpt-research-plugin-executor.ts` | Executor class implementing research actions with OpenAI and Google Search |

---

## Environment Variables

```bash
# Platform-managed - no user configuration required
# These are set at the platform level:
OPENAI_API_KEY=platform_managed
GOOGLE_SEARCH_API_KEY=platform_managed
GOOGLE_SEARCH_ENGINE_ID=platform_managed
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-11-30 | Initial plugin with 3 actions: research_topic, summarize_content, answer_question |
