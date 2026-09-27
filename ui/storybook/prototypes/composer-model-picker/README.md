# Composer model and effort picker

Interactive Storybook proposal under **Tasks → Composer → Model and effort picker**. One composer control opens a picker with the assignee at the top, then the model and a slider for effort. The selected assignee fixes the harness and provider profile; model search is limited to that profile. The picker supports an exact model ID for harnesses that accept one, a slider where effort levels are known, a fast-mode icon toggle in the top right when available, and a reset to the assignee's configured defaults. Sending a message adds an in-memory transcript bubble with the selected settings.

These stories are a design exploration. They do not alter task execution or persist a per-message override. The current adapter model API returns only `{ id, label }`; it cannot tell the client which OpenCode/OpenRouter variants a particular model accepts. The preview therefore uses the model default for those models and for unknown custom IDs. A production implementation should add model capability metadata or a harness-specific capability lookup before enabling their effort slider, and should validate per-message overrides when saving/sending.

## Harness coverage

| Harness | Model selection | Effort | Fast mode |
| --- | --- | --- | --- |
| Codex | Curated/search/manual | Model-specific Codex levels | Known supported models only |
| Claude Code | Curated/search/manual | Low, medium, high on known models | No |
| OpenCode with OpenRouter | Search and `openrouter/provider/model` manual ID | Uses model default until variant metadata is available | No |
| Pi | Search/manual | Off through extra high on known models | No |
| Kimi Code, CLI engine | Search/manual | Low, high, max on K3 only | No |
| Gemini, Cursor, Grok, Hermes CLI | Search/manual | Not offered | No |
| Cursor Cloud | Manual ID, account default | Not offered | No |
| Paperclip Runner with Codex profile | Codex catalog only | Codex levels | Known supported models only |
| Process, HTTP, OpenClaw Gateway, Hermes Gateway | No per-message model setting | Not offered | No |

The fixture models reflect repository adapter contracts as of 2026-09-26; provider availability can still depend on the installed CLI, account, environment, or connection. Switching agents clears the draft run settings. The two remote gateway harnesses deliberately leave model choice with their upstream service.
