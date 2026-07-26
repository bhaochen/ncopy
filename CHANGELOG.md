# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- **Built-in web search design handbook.** Technical guide for the in-app search pipeline: decision stages, engines, language parity, conversation page reuse, security, and UI. See [docs/built-in-web-search.md](docs/built-in-web-search.md). User-facing egress copy: [docs/search-privacy.md](docs/search-privacy.md) (renamed from `search-disclosure.md`).
- **Built-in web search.** Keyless search on the bundled engine: Auto search (Settings → Behavior, default on) may open the web when a plain turn needs live facts; `/search` forces a look-up. Pipeline includes intent verticals, scraped engines, citation audit, progressive search status in chat, and SSRF-safe outbound HTTP. See [docs/built-in-web-search.md](docs/built-in-web-search.md), [docs/configurations.md](docs/configurations.md), and [docs/search-eval.md](docs/search-eval.md). ([#312](https://github.com/quiet-node/thuki/pull/312))
- **Unified trace recorder.** Records every chat conversation (including built-in web-search turns) as JSON-Lines under `app_data_dir/traces/chat/<conversation_id>.jsonl`. Off by default; toggle from Settings or set `[debug] trace_enabled = true` in `config.toml`.

### Changed

- **BREAKING**: Renamed `[debug] search_trace_enabled` to `trace_enabled` (now covers chat and web-search events in the same chat-domain traces). Rename the field in your `config.toml` after upgrading. Trace file layout is `traces/chat/<conversation_id>.jsonl`.
- **Inference providers.** Thuki now reaches models through a typed provider list instead of a single hardcoded Ollama endpoint. The `[inference]` section gains `active_provider` and a `[[inference.providers]]` array; each provider keeps its own selected model. Fresh installs default to the bundled **Built-in (Thuki)** engine, with **Ollama** available as an optional provider. Existing Ollama users are migrated automatically: a legacy flat `ollama_url` becomes the Ollama provider's `base_url`, and the previously selected model is carried over, so nothing changes for them. Settings gains a Providers section (editable Ollama URL with a non-local-server warning, per-provider model picker).
- The internal inference command/hook/error model were renamed to be engine-agnostic: `ask_ollama` → `ask_model`, the `useOllama` hook → `useModel`, and `OllamaError`/`OllamaErrorKind` → `EngineError`/`EngineErrorKind` (the `NotRunning` variant is now `EngineUnreachable`). External callers that invoked `ask_ollama` directly must update to `ask_model`.
- The `ask_model` and `capture_full_screen_command` Tauri commands now require a `conversationId: String` argument (and `ask_model` additionally requires `isFirstTurn: bool` and `slashCommand: Option<String>`). The frontend's `useModel` hook generates a stable trace id per session and threads it transparently. External callers that invoked these commands directly must update their `invoke()` calls. A new fire-and-forget `record_conversation_end` command lets the frontend signal end-of-conversation (used by `useModel.reset()` and `useModel.loadMessages()`) so the chat-domain trace file gets a clean closing line.
- **BREAKING**: Renamed the `[model]` section in `config.toml` to `[inference]` and reshaped it from a single `ollama_url` string into the providers schema described above. There is no backward-compatibility shim for the section name: if you had a custom `[model]` section, rename it to `[inference]` after upgrading; a flat `ollama_url` inside `[inference]` is migrated automatically.
- Active model selection is now strictly Option-typed end to end: when nothing is installed and nothing is persisted, Thuki refuses to dispatch requests and surfaces a "Pick a model" prompt instead of falling back to a hardcoded slug. The previous `DEFAULT_MODEL_NAME` constant has been removed.

## [0.15.2](https://github.com/bhaochen/ncopy/compare/v0.16.2...v0.15.2) (2026-07-26)


### Features

* **activator:** switch activation hotkey from double-Option to double-Command ([39e2fb9](https://github.com/bhaochen/ncopy/commit/39e2fb9709a4554f8a43b4cc6e05115d313761e9))
* add /screen slash command with tab-completion and screen capture ([#35](https://github.com/bhaochen/ncopy/issues/35)) ([5a3ee6a](https://github.com/bhaochen/ncopy/commit/5a3ee6ac8bdcf4e711d95529ea2230eb6993f08c))
* add /searchimage command (text-to-image search via SearXNG + Tavily) ([9edb7ce](https://github.com/bhaochen/ncopy/commit/9edb7ce514c71dd9ef3027d5194e07aad3b4a733))
* add /think command with thinking mode UI ([#85](https://github.com/bhaochen/ncopy/issues/85)) ([0eae923](https://github.com/bhaochen/ncopy/commit/0eae9238fb9cb5475ac79f48f33d19112ce7b83a))
* add a Providers setting to connect Thuki to a local or remote Ollama ([#205](https://github.com/bhaochen/ncopy/issues/205)) ([fe7d3bb](https://github.com/bhaochen/ncopy/commit/fe7d3bb53698c69ec881581f1a45dad9ec421cdb))
* add chat window for conversations ([ba62bd6](https://github.com/bhaochen/ncopy/commit/ba62bd6f4801472551aaf88032820c76ef7e736e))
* add test:all:coverage script for combined frontend and backend coverage enforcement ([b43174a](https://github.com/bhaochen/ncopy/commit/b43174ae395265be96f6c277d0b8107fe8286af7))
* add utility slash commands ([#93](https://github.com/bhaochen/ncopy/issues/93)) ([fa685fc](https://github.com/bhaochen/ncopy/commit/fa685fc9595863ba0ccc551d6d6bf55a64b332a3))
* allow drafting messages while response is streaming in AskBarView ([#200](https://github.com/bhaochen/ncopy/issues/200)) ([27aff25](https://github.com/bhaochen/ncopy/commit/27aff25b24f331ec461a9793d03b77a4a0acea9d))
* allow for Thuki overlap to spawn on fullscreen apps ([3a63244](https://github.com/bhaochen/ncopy/commit/3a63244ba5a2c56fe04eb3e186eb5c312af89c8f))
* built-in engine onboarding, model downloads, Settings providers, and default flip ([#219](https://github.com/bhaochen/ncopy/issues/219)) ([2171044](https://github.com/bhaochen/ncopy/commit/2171044362b527cc190f6eaa4d6af6603514073a))
* built-in web search with auto-search, citation audit, and progressive trace ([#312](https://github.com/bhaochen/ncopy/issues/312)) ([f59f903](https://github.com/bhaochen/ncopy/commit/f59f903eae06b8d4acebdf82dbcc3b81f6df430f))
* bundled engine runner and model library ([#217](https://github.com/bhaochen/ncopy/issues/217)) ([309dfa0](https://github.com/bhaochen/ncopy/commit/309dfa0415b67af2102102a27cf185684e459cff))
* centralize dragging, preserve focus, and tighten shadows ([29e9ae5](https://github.com/bhaochen/ncopy/commit/29e9ae54fd672d82e07073e7379ac4b6c364b163))
* **ci:** add floating nightly release workflow ([#109](https://github.com/bhaochen/ncopy/issues/109)) ([d47c2b5](https://github.com/bhaochen/ncopy/commit/d47c2b55250f8520a7327b94696ef3fcca26dc83))
* **ci:** ship Thuki Nightly as side-by-side signed install ([#336](https://github.com/bhaochen/ncopy/issues/336)) ([ecb4af8](https://github.com/bhaochen/ncopy/commit/ecb4af8f3ac6f6161aa7b460b958435297dd5139))
* **commands:** add /explain slash command with /screen and image support ([#159](https://github.com/bhaochen/ncopy/issues/159)) ([1a00fa1](https://github.com/bhaochen/ncopy/commit/1a00fa1cdd1f66d28789df4023aa986474c50743))
* **commands:** add /extract slash command with Vision OCR text extraction ([#160](https://github.com/bhaochen/ncopy/issues/160)) ([105be14](https://github.com/bhaochen/ncopy/commit/105be1414e525c0d4444a2e3501bddd517052234))
* **commands:** unified slash command dispatch + OCR utility commands ([#164](https://github.com/bhaochen/ncopy/issues/164)) ([fabada1](https://github.com/bhaochen/ncopy/commit/fabada1d788393c58d93fe1bc6adfa6200c3ab76))
* commits should produce 0.x.0 releases (e.g. 0.2.0), not patch ([d53fe45](https://github.com/bhaochen/ncopy/commit/d53fe458064eb783862cbe9a2c7cbd1935118308))
* **config:** make max_images user-tunable with a cap of 20 ([#121](https://github.com/bhaochen/ncopy/issues/121)) ([e3a2dbf](https://github.com/bhaochen/ncopy/commit/e3a2dbfb1cb98b8c2da5dc8ae38b757ee7d7f17e))
* **config:** migrate runtime configuration from env vars to TOML ([#102](https://github.com/bhaochen/ncopy/issues/102)) ([e9f55f6](https://github.com/bhaochen/ncopy/commit/e9f55f694f33e598448d88b77b5dc6713d40978d))
* **config:** user-tunable context window with log-scale slider ([#120](https://github.com/bhaochen/ncopy/issues/120)) ([de2cb64](https://github.com/bhaochen/ncopy/commit/de2cb64dc7f00c924eb404aa8fb4524dada5cd35))
* context-aware AskBar with smart positioning ([9a9593c](https://github.com/bhaochen/ncopy/commit/9a9593c950f1ce41ac1a7f1be99f233b99ddb501))
* **continuity:** cross-model history sanitization and capability-aware filtering ([#107](https://github.com/bhaochen/ncopy/issues/107)) ([be48d88](https://github.com/bhaochen/ncopy/commit/be48d8824912514648c0e8c1e463654948d4526b))
* conversation history frontend ([#19](https://github.com/bhaochen/ncopy/issues/19)) ([1138a8d](https://github.com/bhaochen/ncopy/commit/1138a8d3402b33526251de6e2ec0f437190edb2c))
* conversation-wide search evidence reuse ([#330](https://github.com/bhaochen/ncopy/issues/330)) ([ae9c3cc](https://github.com/bhaochen/ncopy/commit/ae9c3cc7219316cdf58152fbbd2e8be47d8f44ed))
* cut ForceWeb search latency and harden answer quality ([#324](https://github.com/bhaochen/ncopy/issues/324)) ([fdc8af0](https://github.com/bhaochen/ncopy/commit/fdc8af068ed9a300fff1eec8cc095ed5651483c2))
* export chat session to Markdown and clipboard ([#189](https://github.com/bhaochen/ncopy/issues/189)) ([a9ffbc9](https://github.com/bhaochen/ncopy/commit/a9ffbc98df679d33d842505f4ad89617a19b10e4))
* friendly error UI for Ollama not running / model not found ([#61](https://github.com/bhaochen/ncopy/issues/61)) ([a5fc922](https://github.com/bhaochen/ncopy/commit/a5fc9229cda0bb41b541b5f3acf600a968e252e9))
* history panel UX improvements ([#26](https://github.com/bhaochen/ncopy/issues/26)) ([cf8edf1](https://github.com/bhaochen/ncopy/commit/cf8edf1de7989a5b893fd19894d18939755b90d7))
* **history:** auto-save chats with retention and free chats ([#331](https://github.com/bhaochen/ncopy/issues/331)) ([53a5d11](https://github.com/bhaochen/ncopy/commit/53a5d11275a171f383785f242fb90a619a12c33a))
* holistically updated chat interface overlay ([d9f7a0c](https://github.com/bhaochen/ncopy/commit/d9f7a0c50c87e94bd959aba37f9ad5747b97a468))
* image and screenshot input support ([#28](https://github.com/bhaochen/ncopy/issues/28)) ([3a3bf8d](https://github.com/bhaochen/ncopy/commit/3a3bf8db2b6523de7abe45f69f417bb4879a7013))
* implement /screen full-screen capture on Linux (grim/import) ([85ef2b6](https://github.com/bhaochen/ncopy/commit/85ef2b63a583b1cfeb19836dce8310a55ad25698))
* implement professional overlay activator and nspanel integration ([a5919db](https://github.com/bhaochen/ncopy/commit/a5919dbbef9330ca02fe6e7cd722a9753bc7300d))
* implement secure, isolated Docker sandbox for LLM inference ([15c65ab](https://github.com/bhaochen/ncopy/commit/15c65abd4ec70965c60312eb3eadc95ae8e69036))
* improve context awareness and image handling for better multimodal understanding ([302e5ea](https://github.com/bhaochen/ncopy/commit/302e5ea60671a0b8d438760d054d4c324460836f))
* in-app model picker with hardened selection pipeline ([#103](https://github.com/bhaochen/ncopy/issues/103)) ([c8c229a](https://github.com/bhaochen/ncopy/commit/c8c229aff4d941b9d7e132ef36fe91fec68d8607))
* initial commit ([50a0578](https://github.com/bhaochen/ncopy/commit/50a05784025d3975613bfeabe32b6b27bbbfeba8))
* introduce agentic search pipeline with live trace streaming ([#100](https://github.com/bhaochen/ncopy/issues/100)) ([8586c8a](https://github.com/bhaochen/ncopy/commit/8586c8a3fea78a95cae701395cca3a9e6f28a110))
* let chat fill the screen by capping max height at screen.availHeight ([31914aa](https://github.com/bhaochen/ncopy/commit/31914aa44c120f8d76e692de5cf3c7b18aa45160))
* **markdown:** add KaTeX math rendering via Streamdown plugin API ([#156](https://github.com/bhaochen/ncopy/issues/156)) ([298714a](https://github.com/bhaochen/ncopy/commit/298714a276d96d63ac41fbc3d7473d641e04fd9f))
* migrate AskBar input to Lexical to fix WKWebView caret drift ([#202](https://github.com/bhaochen/ncopy/issues/202)) ([adc8feb](https://github.com/bhaochen/ncopy/commit/adc8feb3dbb1665fccf09bc741c6793f527cf152))
* **minimize:** collapse the chat to a floating mascot with edge-aware restore ([#187](https://github.com/bhaochen/ncopy/issues/187)) ([d18c890](https://github.com/bhaochen/ncopy/commit/d18c8901ab8ba037fcf2034170280c805df6b11e))
* **model-picker:** add larger-models nudge hint ([#118](https://github.com/bhaochen/ncopy/issues/118)) ([3074386](https://github.com/bhaochen/ncopy/commit/3074386b7ce84284eabf8dc2c773be729f363dc7))
* **models:** clickable Browse-all quant filenames + non-blocking model delete ([#271](https://github.com/bhaochen/ncopy/issues/271)) ([ff4e4b3](https://github.com/bhaochen/ncopy/commit/ff4e4b3efea6ff3b283df180512d8b0cdcc08955))
* **models:** in-app model library with Discover browser and Staff Picks ([#237](https://github.com/bhaochen/ncopy/issues/237)) ([878f8a1](https://github.com/bhaochen/ncopy/commit/878f8a1ec92ec82417556ed1a208294c18979cf6))
* **models:** sync live download progress across windows ([#250](https://github.com/bhaochen/ncopy/issues/250)) ([5edb2ae](https://github.com/bhaochen/ncopy/commit/5edb2ae94dbe2a71ee419fa4fd35f73867c25d05))
* move Diagnostics to Behavior tab with trace retention and folder actions ([#325](https://github.com/bhaochen/ncopy/issues/325)) ([f356985](https://github.com/bhaochen/ncopy/commit/f356985269e7b34bd1690398f6c02996a97ca3c2))
* multi-turn conversation via Ollama /api/chat ([#16](https://github.com/bhaochen/ncopy/issues/16)) ([1641ff7](https://github.com/bhaochen/ncopy/commit/1641ff7c1a69bce61dfc808e641c8ef6b2a6f7f9))
* onboarding flow with permission-gated stage machine ([#65](https://github.com/bhaochen/ncopy/issues/65)) ([18990c7](https://github.com/bhaochen/ncopy/commit/18990c767f0a918a36c4c4c2c8e561b2adc0ef66))
* onboarding screen for macOS permission setup ([#54](https://github.com/bhaochen/ncopy/issues/54)) ([71e5a9a](https://github.com/bhaochen/ncopy/commit/71e5a9a23317d62e2f28ded2c3270341107a90ae))
* **onboarding:** built-in engine upgrade announcement and onboarding/picker polish ([#251](https://github.com/bhaochen/ncopy/issues/251)) ([21aabba](https://github.com/bhaochen/ncopy/commit/21aabbacc7c0b979cd5ad6dbeca3bb93aa7de964))
* **onboarding:** optional email capture to help shape Thuki ([#254](https://github.com/bhaochen/ncopy/issues/254)) ([ab725fc](https://github.com/bhaochen/ncopy/commit/ab725fcde2f3c7892d20114a3d8de4fdccb0c582))
* **onboarding:** surface-aware download strip and model-library intro fact ([#252](https://github.com/bhaochen/ncopy/issues/252)) ([bd6f18e](https://github.com/bhaochen/ncopy/commit/bd6f18e062c9924459debbbc3894ce2b8f1ed039))
* open source readiness ([#32](https://github.com/bhaochen/ncopy/issues/32)) ([f1471d5](https://github.com/bhaochen/ncopy/commit/f1471d55fd1df6e7b9cc3555a85ceca17c786b7f))
* OpenAI-compatible /v1 client and provider routing ([#218](https://github.com/bhaochen/ncopy/issues/218)) ([8fc2d16](https://github.com/bhaochen/ncopy/commit/8fc2d1679a5169fbedb9060f10d8b355e0a48b19))
* overhaul system prompt and move to dedicated file ([#64](https://github.com/bhaochen/ncopy/issues/64)) ([ce895e6](https://github.com/bhaochen/ncopy/commit/ce895e67046e2addee0a68d4c6629cca8946eb31))
* pre-load conversation list before opening ask-bar history drawer ([#199](https://github.com/bhaochen/ncopy/issues/199)) ([e7645a6](https://github.com/bhaochen/ncopy/commit/e7645a60cc0cfa1eb7e1142a6515040635d9bf72))
* pre-seed assistant message with images in /searchimage ([ce7c156](https://github.com/bhaochen/ncopy/commit/ce7c15616778d81fd351793e0473bea4366675ba))
* redesign /rewrite for a natural, casual voice ([#201](https://github.com/bhaochen/ncopy/issues/201)) ([b762974](https://github.com/bhaochen/ncopy/commit/b7629745be2a99f38cfcafcbd1b81fbfb9fef57a))
* replace application icons with new mascot logo and update tray resolution ([e39a7cd](https://github.com/bhaochen/ncopy/commit/e39a7cd3dd005d0b07198190745fb896593dece0))
* replace markdown images with ImageGallery carousel for /searchimage ([82d4d8e](https://github.com/bhaochen/ncopy/commit/82d4d8e1f579780c9eaf38ce4babf295dc1116e2))
* replace react-markdown with streamdown for jitter-free streaming ([#17](https://github.com/bhaochen/ncopy/issues/17)) ([259c212](https://github.com/bhaochen/ncopy/commit/259c212fb09baafee20d5105009a0dbbfef71a6e))
* restore the Providers setting reverted by [#208](https://github.com/bhaochen/ncopy/issues/208) ([#215](https://github.com/bhaochen/ncopy/issues/215)) ([9626a43](https://github.com/bhaochen/ncopy/commit/9626a43af063f0ba97ddbf7b34e79a2c312815c7))
* screenshot capture for image input ([#31](https://github.com/bhaochen/ncopy/issues/31)) ([e274ad6](https://github.com/bhaochen/ncopy/commit/e274ad6c7047ddf8d7f992e563cbcbb8b0127d31))
* search language parity across retrieval and answers ([#326](https://github.com/bhaochen/ncopy/issues/326)) ([6b108d2](https://github.com/bhaochen/ncopy/commit/6b108d2a4bb1d5fc35f1469c33d032a2a62960e9))
* search resilience and citation a11y ([#327](https://github.com/bhaochen/ncopy/issues/327)) ([1922f78](https://github.com/bhaochen/ncopy/commit/1922f78f7338be31cbb668e227041ad17bfba737))
* search trust and lawfulness package ([#323](https://github.com/bhaochen/ncopy/issues/323)) ([c5196eb](https://github.com/bhaochen/ncopy/commit/c5196eb288d6b8a5d46e7445d2b12549883684c9))
* **search:** add forensic trace recorder ([#126](https://github.com/bhaochen/ncopy/issues/126)) ([5980abe](https://github.com/bhaochen/ncopy/commit/5980abed8559c30553083912b2f1d3d4c5072c35))
* secure ollama integration with lean architecture ([97d16db](https://github.com/bhaochen/ncopy/commit/97d16dbbd8276448537c5808f787af2b2f5a410b))
* selected-text quote display with .env-driven configuration ([#1](https://github.com/bhaochen/ncopy/issues/1)) ([45a5664](https://github.com/bhaochen/ncopy/commit/45a56640a14990cc5ccafb5216bcb4c02e1eed9a))
* **settings:** Changelog tab with full release history ([#328](https://github.com/bhaochen/ncopy/issues/328)) ([02b47b9](https://github.com/bhaochen/ncopy/commit/02b47b98d47529fa0b1c9d51bb1ab5014c59b71d))
* **settings:** subtle model-name links with hover reveal ([#255](https://github.com/bhaochen/ncopy/issues/255)) ([039e1d2](https://github.com/bhaochen/ncopy/commit/039e1d2f22ffc64c2cdf263ddd4984d28c83723f))
* **settings:** subtle model-name links with hover reveal; italic founder name ([039e1d2](https://github.com/bhaochen/ncopy/commit/039e1d2f22ffc64c2cdf263ddd4984d28c83723f))
* **settings:** user-configurable typography controls for chat and input ([#172](https://github.com/bhaochen/ncopy/issues/172)) ([6ac531a](https://github.com/bhaochen/ncopy/commit/6ac531a32e4a572287cc7c5de377a0ee35d8ccf5))
* show AskBar automatically on app launch ([#48](https://github.com/bhaochen/ncopy/issues/48)) ([7329bf8](https://github.com/bhaochen/ncopy/commit/7329bf8d1c7be255f080406fb35960b083f57ae6))
* spring-driven morph animation for askbar-to-chat transition ([#11](https://github.com/bhaochen/ncopy/issues/11)) ([5193578](https://github.com/bhaochen/ncopy/commit/519357817d4631d3c19a727b43cc415ba251c2e2))
* SQLite persistence layer for conversation history (backend) ([#18](https://github.com/bhaochen/ncopy/issues/18)) ([1d4664d](https://github.com/bhaochen/ncopy/commit/1d4664ddd4b3c10fdfc34f827d0a62a840d91e7f))
* stream cancellation with stop generating button ([#13](https://github.com/bhaochen/ncopy/issues/13)) ([29099ff](https://github.com/bhaochen/ncopy/commit/29099ff009398f82ae1d338c49dcb9b267167e89))
* sync slash command docs and prompt metadata ([#101](https://github.com/bhaochen/ncopy/issues/101)) ([e187809](https://github.com/bhaochen/ncopy/commit/e187809b5e08fc24cc0ff57262eb42c2ebf6ac95))
* **trace:** unified per-conversation forensic recorder for chat + search ([#139](https://github.com/bhaochen/ncopy/issues/139)) ([2d24759](https://github.com/bhaochen/ncopy/commit/2d2475961092d3ab3680b239108e9c70ddfeb728))
* **tray:** left-click opens Thuki, right-click shows menu ([#123](https://github.com/bhaochen/ncopy/issues/123)) ([b8d6604](https://github.com/bhaochen/ncopy/commit/b8d660491258ca5c64030d1a0191413d0ce864d7))
* UI polish — chat redesign, spiral loader, smooth upward animation ([#21](https://github.com/bhaochen/ncopy/issues/21)) ([2d7320f](https://github.com/bhaochen/ncopy/commit/2d7320f9a7dbb1faa293238d5b25df76a57bd3b2))
* UI polish, conversation save/unsave, and window positioning ([#24](https://github.com/bhaochen/ncopy/issues/24)) ([ee4d91f](https://github.com/bhaochen/ncopy/commit/ee4d91fd0446bd35925b2ed42514fe55edd1ce6f))
* **ui:** add tip bar with contextual usage tips ([#119](https://github.com/bhaochen/ncopy/issues/119)) ([1ffda74](https://github.com/bhaochen/ncopy/commit/1ffda7434d7b17d1d5b37ab9a545295ad60f378d))
* **ui:** added copy button for chat bubble ([709f8b9](https://github.com/bhaochen/ncopy/commit/709f8b982635aa17dbc19fd9219970e0cadfdf3e))
* update activator key to Ctrl and adjust default ask bar position ([#23](https://github.com/bhaochen/ncopy/issues/23)) ([02a26d8](https://github.com/bhaochen/ncopy/commit/02a26d853a205bef9fa01da4292256454f2617d5))
* **updater:** in-app auto-update via signed GitHub releases ([#144](https://github.com/bhaochen/ncopy/issues/144)) ([74a7751](https://github.com/bhaochen/ncopy/commit/74a7751513a95e0a764e356433ba815f9ea24157))
* **updater:** redesign What's New window to match Settings panel ([d6d5e09](https://github.com/bhaochen/ncopy/commit/d6d5e09aed7612459adcfabb445b8c9a8f046187))
* **updater:** What's New update window with explicit actions; open Settings on current Space ([#174](https://github.com/bhaochen/ncopy/issues/174)) ([35a591b](https://github.com/bhaochen/ncopy/commit/35a591bab0d9034f63a345dfea418b699cfdd4b6))
* upgrade to Gemma4 and add runtime model configuration ([#63](https://github.com/bhaochen/ncopy/issues/63)) ([360c2a8](https://github.com/bhaochen/ncopy/commit/360c2a8afdd77248524d1a94c29c820a49283fec))
* vertical wheel scroll translates to horizontal pan in ImageGallery ([b4ee85b](https://github.com/bhaochen/ncopy/commit/b4ee85bd834bed8e009956dfffbae629d1a9a58a))
* write /rewrite and /refine results back into the source app ([#197](https://github.com/bhaochen/ncopy/issues/197)) ([12536f5](https://github.com/bhaochen/ncopy/commit/12536f52564cdfd2642e0532ab29c13d33249723))
* 把 build_app_menu 函数以及 .menu(build_app_menu) 和 .on_menu_event(...) 调用用 #[cfg(target_os = macos)] 包裹起来，Linux 上就不会再注册应用菜单了 ([f0e72d1](https://github.com/bhaochen/ncopy/commit/f0e72d12c334e5c696d4aa738b79d0fbca8bfd00))


### Bug Fixes

* ad-hoc sign local macOS builds so TCC grants apply ([#229](https://github.com/bhaochen/ncopy/issues/229)) ([1b29e2e](https://github.com/bhaochen/ncopy/commit/1b29e2e2e237b4ca45ad25203e709d07a0235755))
* add Signed-off-by to release-please and Cargo.lock sync commits ([#45](https://github.com/bhaochen/ncopy/issues/45)) ([b8a16e8](https://github.com/bhaochen/ncopy/commit/b8a16e8d0eaa4f5fce8dcf64031570c608e0c6cf))
* auto-scroll stops following streaming after max height reached ([#12](https://github.com/bhaochen/ncopy/issues/12)) ([33c3306](https://github.com/bhaochen/ncopy/commit/33c3306b5f5f36e037391e4a3f7929c17e274a1f))
* cancel active streaming on overlay hide and app quit ([#73](https://github.com/bhaochen/ncopy/issues/73)) ([862d34b](https://github.com/bhaochen/ncopy/commit/862d34b93efdd6e84a351758d46ece4de96fba6e))
* cancel in-flight generation when starting a new session ([#289](https://github.com/bhaochen/ncopy/issues/289)) ([77c4e98](https://github.com/bhaochen/ncopy/commit/77c4e98f5bebbe7018c3ed040e8522216e5dabfa))
* **chat:** prevent source-row clicks from opening URL twice ([#104](https://github.com/bhaochen/ncopy/issues/104)) ([b602bd3](https://github.com/bhaochen/ncopy/commit/b602bd3df6e309dc177c5d4f9fe53ae0180021ac))
* **ci:** cap engine build parallelism by RAM to avoid OOM stalls ([#270](https://github.com/bhaochen/ncopy/issues/270)) ([c15d5a4](https://github.com/bhaochen/ncopy/commit/c15d5a425c5df6ff680497f113e6ed9969e83957))
* **ci:** cap engine build parallelism by RAM to avoid OOM stalls on CI runners ([c15d5a4](https://github.com/bhaochen/ncopy/commit/c15d5a425c5df6ff680497f113e6ed9969e83957))
* **ci:** fetch llama-server sidecar before lint in release job ([732a233](https://github.com/bhaochen/ncopy/commit/732a233b2f2c4e1550362e7b65a4d0815190e0b9))
* **ci:** fetch llama-server sidecar before lint in release publish job ([#261](https://github.com/bhaochen/ncopy/issues/261)) ([732a233](https://github.com/bhaochen/ncopy/commit/732a233b2f2c4e1550362e7b65a4d0815190e0b9))
* **ci:** make engine-gate throughput report-only instead of a blocking floor ([#321](https://github.com/bhaochen/ncopy/issues/321)) ([5cf4e8f](https://github.com/bhaochen/ncopy/commit/5cf4e8f898072bf2316ea53b6c3dbfebd1dd6e31))
* **ci:** set VITE_GIT_COMMIT_SHA on tauri build step not frontend step ([#111](https://github.com/bhaochen/ncopy/issues/111)) ([5305c53](https://github.com/bhaochen/ncopy/commit/5305c53af2303a6c1acf8c6738175dd9767da15c))
* **config:** restore default system prompt on upgrade for uncustomized configs ([#158](https://github.com/bhaochen/ncopy/issues/158)) ([dab2f2f](https://github.com/bhaochen/ncopy/commit/dab2f2f86d38fafba309a996015070f0190925ff))
* **context:** detect clipboard fallback copy by content, not by change ([#285](https://github.com/bhaochen/ncopy/issues/285)) ([22d102c](https://github.com/bhaochen/ncopy/commit/22d102c76fec2022559a97611b57d73410f70de1))
* define missing background theme token for Streamdown table menus ([#292](https://github.com/bhaochen/ncopy/issues/292)) ([37a3758](https://github.com/bhaochen/ncopy/commit/37a375836fd42dfbddde0fef9bf53cb57e50a893))
* disclose when a requested web search can't reach the web or finds nothing ([#314](https://github.com/bhaochen/ncopy/issues/314)) ([974cf02](https://github.com/bhaochen/ncopy/commit/974cf02d7f7997e67f1247da1f5d6f6d18f092b0))
* **downloads:** RAM-fit starter swap, non-blocking sends, cross-window pause/discard sync ([#269](https://github.com/bhaochen/ncopy/issues/269)) ([5b742f1](https://github.com/bhaochen/ncopy/commit/5b742f1738b60fc478e6c353514ec6c2f8f4963f))
* eliminate streaming jitter during upward window growth ([#10](https://github.com/bhaochen/ncopy/issues/10)) ([7c83147](https://github.com/bhaochen/ncopy/commit/7c831473f0ffb52373d2ef77478b22694e2651a4))
* emit terminal Done when the model stream ends without a done marker ([#212](https://github.com/bhaochen/ncopy/issues/212)) ([f4d5271](https://github.com/bhaochen/ncopy/commit/f4d5271ce2271f3b8d24d12320cf3450da354e4d))
* enable drag-and-drop image support in Thuki window ([79842c3](https://github.com/bhaochen/ncopy/commit/79842c36042b91c43b87c00553088da54a8f8c61))
* **engine:** support macOS 13.4+ for the built-in engine ([#266](https://github.com/bhaochen/ncopy/issues/266)) ([70fab74](https://github.com/bhaochen/ncopy/commit/70fab745897e215c73eb05f81401da1f685ec1d8))
* enlarge close button hit area to fix unreliable click ([#82](https://github.com/bhaochen/ncopy/issues/82)) ([8ed46ca](https://github.com/bhaochen/ncopy/commit/8ed46caf14037cb1f842bfac1690ae5351d77bcd))
* fetch llama-server sidecar before lint in nightly release ([#235](https://github.com/bhaochen/ncopy/issues/235)) ([41e677a](https://github.com/bhaochen/ncopy/commit/41e677a2819552d52fadfdea3eb585a3b7fafbb4))
* fix auto scroll + regression tests for incremental resize ([#14](https://github.com/bhaochen/ncopy/issues/14)) ([5dd61e3](https://github.com/bhaochen/ncopy/commit/5dd61e3258b96d7d311b50d7046002ace43d7a4b))
* gate overlay activation during onboarding to prevent window collapse ([#233](https://github.com/bhaochen/ncopy/issues/233)) ([21f547e](https://github.com/bhaochen/ncopy/commit/21f547e4312eb53e85c72b44029afa6d186efe58))
* harden memory, download, and crash-recovery guardrails ([#306](https://github.com/bhaochen/ncopy/issues/306)) ([df23797](https://github.com/bhaochen/ncopy/commit/df237976ad409f575a1c7197f074cb6dc98ee3bf))
* hide search input when switch confirmation is shown ([#27](https://github.com/bhaochen/ncopy/issues/27)) ([1dc9d95](https://github.com/bhaochen/ncopy/commit/1dc9d958c35c0973e452aeaf05cfe0cd9acdf2af))
* intercept drops at root level and add max-images UX feedback ([#90](https://github.com/bhaochen/ncopy/issues/90)) ([eb2af01](https://github.com/bhaochen/ncopy/commit/eb2af01f8bb5f5de36dbd941d6cd49d0f00b0a94))
* listen to window resize events so the chat height adapts to manual resize ([1f1c37a](https://github.com/bhaochen/ncopy/commit/1f1c37af626fa2b7055029a5b4b92350bc7f1857))
* macOS distribution improvements (signing, DMG installer, permissions) ([#36](https://github.com/bhaochen/ncopy/issues/36)) ([216360a](https://github.com/bhaochen/ncopy/commit/216360a7b7647cdc30585c125b91c051dfc2c45d))
* make /rewrite preserve formatting, structure, and verbatim content ([#207](https://github.com/bhaochen/ncopy/issues/207)) ([ac23627](https://github.com/bhaochen/ncopy/commit/ac236273bbbe55dee65ecc60f8413a27ccea00a8))
* **math:** escape currency dollars so they aren't parsed as LaTeX math ([#180](https://github.com/bhaochen/ncopy/issues/180)) ([72cd69b](https://github.com/bhaochen/ncopy/commit/72cd69b45313ca3f5d77182a9294bffe862f21be))
* **models:** gate browse installs to chat brains only ([467c3c9](https://github.com/bhaochen/ncopy/commit/467c3c9a063a4669fd522315e90cdfb3aca568e9))
* **models:** gate Browse installs to chat brains only ([#337](https://github.com/bhaochen/ncopy/issues/337)) ([467c3c9](https://github.com/bhaochen/ncopy/commit/467c3c9a063a4669fd522315e90cdfb3aca568e9))
* **models:** remember per-model memory-fit override ([#339](https://github.com/bhaochen/ncopy/issues/339)) ([b85be38](https://github.com/bhaochen/ncopy/commit/b85be386d94adbb6d880ee477dcddfd20b7d6131))
* **models:** update UI for multi-part (split) GGUF models ([#267](https://github.com/bhaochen/ncopy/issues/267)) ([78798e9](https://github.com/bhaochen/ncopy/commit/78798e97d2305aadd30bf9a8e2c821474ef98ad3))
* move signoff to top-level in release-please config ([#47](https://github.com/bhaochen/ncopy/issues/47)) ([1a9db12](https://github.com/bhaochen/ncopy/commit/1a9db12f7cc5485a267bafe82e7c06f3a4d366a2))
* onboarding permission loop on local macOS builds ([#230](https://github.com/bhaochen/ncopy/issues/230)) ([1b29e2e](https://github.com/bhaochen/ncopy/commit/1b29e2e2e237b4ca45ad25203e709d07a0235755))
* pass /searchimage as slashCommand so backend skips auto-search and does not overwrite pre-filled sources ([f6d2039](https://github.com/bhaochen/ncopy/commit/f6d20394dbd94d9cc6f4c1f4fc5253b5ec58847e))
* **permissions:** clear stale TCC entries on upgrade and grant click ([#153](https://github.com/bhaochen/ncopy/issues/153)) ([979b7f8](https://github.com/bhaochen/ncopy/commit/979b7f8fc85600d90884de5592563660949f4efc))
* persist image_search_hits through history, fix all compile/lint/test gates ([824ff42](https://github.com/bhaochen/ncopy/commit/824ff42d04441b1ead23b7071c0358467fb16304))
* persist onboarding progress so relaunch can't bounce permissions ([#229](https://github.com/bhaochen/ncopy/issues/229)) ([70d0eeb](https://github.com/bhaochen/ncopy/commit/70d0eeb8664ee50722aba7fde5030488320a78c1))
* populate searchSources for /searchimage so source citation chips appear ([4aad2a9](https://github.com/bhaochen/ncopy/commit/4aad2a9eb9fe53522c84b81c2f9224a2114d808c))
* preserve image preSeedContent through SetContent ([a7fd1ec](https://github.com/bhaochen/ncopy/commit/a7fd1ec1719c00ca10d1af8c751959c0a55920b1))
* preserve scroll position when streaming finishes ([#70](https://github.com/bhaochen/ncopy/issues/70)) ([49ed079](https://github.com/bhaochen/ncopy/commit/49ed079bbbd6638fc4b5a16000d28f29039ca634))
* preserve whitespace formatting in user chat bubbles ([#30](https://github.com/bhaochen/ncopy/issues/30)) ([a5c9680](https://github.com/bhaochen/ncopy/commit/a5c96800f7ee6702503c712fd30e92139775ca27))
* prevent parent vertical scroll when wheeling over ImageGallery ([d65a899](https://github.com/bhaochen/ncopy/commit/d65a8995153c215d4db04713febac7ec8f38f9b9))
* **prompt:** stop base system prompt forcing language guesses on all providers ([#350](https://github.com/bhaochen/ncopy/issues/350)) ([692762d](https://github.com/bhaochen/ncopy/commit/692762d6fffb8b9ea1593b9dd1a5552ce6fd1a00))
* **prompt:** stop model from emitting slash commands as replies ([#243](https://github.com/bhaochen/ncopy/issues/243)) ([e3091e5](https://github.com/bhaochen/ncopy/commit/e3091e528f60453671648d12ce6634d9ecad7e5c))
* raise Vite chunkSizeWarningLimit to suppress bundle size warning ([#15](https://github.com/bhaochen/ncopy/issues/15)) ([ae1c3f1](https://github.com/bhaochen/ncopy/commit/ae1c3f10e34c5706df91ce7a699f61e151c7e10e))
* redesign history panel search field and active row indicator ([#294](https://github.com/bhaochen/ncopy/issues/294)) ([22c0cba](https://github.com/bhaochen/ncopy/commit/22c0cba4d2a85e4d55a1e83a6c5a8de68f617493))
* regain overlay focus after defocus via hover-activate tracking area ([#234](https://github.com/bhaochen/ncopy/issues/234)) ([0a982f6](https://github.com/bhaochen/ncopy/commit/0a982f6861ab01b123b8cce2078fec43b4dbe741))
* remove broken image links from ImageGallery via onError detection ([11ecc45](https://github.com/bhaochen/ncopy/commit/11ecc453ce3b77220f884453a43d9b5ade68c570))
* remove Input Monitoring and suppress native permission popups ([#68](https://github.com/bhaochen/ncopy/issues/68)) ([1d62ddc](https://github.com/bhaochen/ncopy/commit/1d62ddc35d26f7ad8f9ceb7c1a22d53d0e8c763b))
* replace anchor system with simple screen-bottom growth detection ([#74](https://github.com/bhaochen/ncopy/issues/74)) ([8358ce7](https://github.com/bhaochen/ncopy/commit/8358ce7291a4b47b360a65b468944763f779ddb4))
* replace marked+DOMPurify with react-markdown and add stable message keys ([5868fbd](https://github.com/bhaochen/ncopy/commit/5868fbdba783f8746f7a5c23b3a1a1b25ccf6027))
* replace marked+DOMPurify with react-markdown, add stable message keys ([#9](https://github.com/bhaochen/ncopy/issues/9)) ([5868fbd](https://github.com/bhaochen/ncopy/commit/5868fbdba783f8746f7a5c23b3a1a1b25ccf6027))
* resolve production screenshot bugs (CSP blob URLs, black screen) ([#41](https://github.com/bhaochen/ncopy/issues/41)) ([7f51150](https://github.com/bhaochen/ncopy/commit/7f5115084701ae0d35ad41d93050fe55776fa175))
* restore cross-app hotkey via HID tap + active tap options ([#66](https://github.com/bhaochen/ncopy/issues/66)) ([a1781c9](https://github.com/bhaochen/ncopy/commit/a1781c923c23e4ee639b69aa4d3c3dbf381890b3))
* retain conversation context when generation is cancelled ([#25](https://github.com/bhaochen/ncopy/issues/25)) ([4419dcf](https://github.com/bhaochen/ncopy/commit/4419dcf1d9d0a74483a48b60cfe25dbd6eb4e4c9))
* revert Cargo.lock commit to plain git push ([a5d7dd4](https://github.com/bhaochen/ncopy/commit/a5d7dd48db0de735fcda2d627812d34b25364365))
* revert Cargo.lock sync commit to plain git push ([#52](https://github.com/bhaochen/ncopy/issues/52)) ([a5d7dd4](https://github.com/bhaochen/ncopy/commit/a5d7dd48db0de735fcda2d627812d34b25364365))
* **screenshot:** capture display containing Thuki window on multi-monitor setups ([#191](https://github.com/bhaochen/ncopy/issues/191)) ([d7d999e](https://github.com/bhaochen/ncopy/commit/d7d999ed0f4439e06d4c2d559bd013427c05ca86))
* **search:** correct Setup Guide anchor in sandbox-offline card ([#112](https://github.com/bhaochen/ncopy/issues/112)) ([707106b](https://github.com/bhaochen/ncopy/commit/707106b6d0795a6e8b0e73f67416c1bc351bce46))
* **search:** disclose when a requested web search is unreachable or finds nothing ([974cf02](https://github.com/bhaochen/ncopy/commit/974cf02d7f7997e67f1247da1f5d6f6d18f092b0))
* **search:** harden judge fallback and config allowlist ([#125](https://github.com/bhaochen/ncopy/issues/125)) ([7a2eecb](https://github.com/bhaochen/ncopy/commit/7a2eecb5e11c9e2c3dcb6e8ba549cc760842245a))
* **settings:** allow text selection in settings panel ([#122](https://github.com/bhaochen/ncopy/issues/122)) ([55100fd](https://github.com/bhaochen/ncopy/commit/55100fd94e0006cbd14dbd180d25fd5c90330418))
* **settings:** eliminate Dock icon by converting settings window to NSPanel ([#117](https://github.com/bhaochen/ncopy/issues/117)) ([d4d72de](https://github.com/bhaochen/ncopy/commit/d4d72de4892cb6ea26bdf0608bc18c4b6ad3c5bc))
* **settings:** redesign About Updates as hero card with check animation ([#145](https://github.com/bhaochen/ncopy/issues/145)) ([5fa50e4](https://github.com/bhaochen/ncopy/commit/5fa50e46eb6afe18522f7e4cde9baf1d6313e8e4))
* **settings:** repair keep-warm minutes input UX ([#127](https://github.com/bhaochen/ncopy/issues/127)) ([733c9f0](https://github.com/bhaochen/ncopy/commit/733c9f065768ecf97905f25370afa6ebf775a9c1))
* show all versions between installed and latest in What's New ([#203](https://github.com/bhaochen/ncopy/issues/203)) ([0f14459](https://github.com/bhaochen/ncopy/commit/0f1445992f5c2599e360925d89527923c1d52062))
* show cold-start loading label during engine warmup ([#287](https://github.com/bhaochen/ncopy/issues/287)) ([f004b47](https://github.com/bhaochen/ncopy/commit/f004b47b0b40d17a40fb38cd93eee9b972710c77))
* skip false starting-up copy when engine is already loaded ([#291](https://github.com/bhaochen/ncopy/issues/291)) ([f7f62cd](https://github.com/bhaochen/ncopy/commit/f7f62cdb1ec7308efd68de68df0952f09f1b5a6b))
* **style:** redesign What's New window to match Settings panel ([#177](https://github.com/bhaochen/ncopy/issues/177)) ([d6d5e09](https://github.com/bhaochen/ncopy/commit/d6d5e09aed7612459adcfabb445b8c9a8f046187))
* surface the 80% memory headroom rule in the model-fit warning ([#322](https://github.com/bhaochen/ncopy/issues/322)) ([71a201f](https://github.com/bhaochen/ncopy/commit/71a201f94dc35fbc13695194eb13da59f8d4f28a))
* sync Cargo.lock and add workflow to keep it in sync on release PRs ([2a2ab86](https://github.com/bhaochen/ncopy/commit/2a2ab86b37528e53d86bc787d3c5a7e0821f9186))
* sync Cargo.lock on release PRs via release workflow ([#43](https://github.com/bhaochen/ncopy/issues/43)) ([2a2ab86](https://github.com/bhaochen/ncopy/commit/2a2ab86b37528e53d86bc787d3c5a7e0821f9186))
* sync Cargo.lock to reflect 0.2.0 version bump ([47d9a68](https://github.com/bhaochen/ncopy/commit/47d9a68102787febac5b86d5df96a968379528a2))
* trim the system prompt and refresh non-customized prompts on load ([#239](https://github.com/bhaochen/ncopy/issues/239)) ([91de26d](https://github.com/bhaochen/ncopy/commit/91de26deb54adfeb42bb8b7c38e7440d611b9e03))
* **ui:** adopt Source Serif 4 for AI prose reading register ([#140](https://github.com/bhaochen/ncopy/issues/140)) ([1580156](https://github.com/bhaochen/ncopy/commit/15801564f0e6f4ad64bf152ddf23da1fcf772660))
* **ui:** enable text selection in chat bubbles while maintaining window drag ([8ae8b49](https://github.com/bhaochen/ncopy/commit/8ae8b4903e22885d67e266955c2ae8deb06bc737))
* **ui:** hide Dock icon on Settings close and refocus without recentering ([#280](https://github.com/bhaochen/ncopy/issues/280)) ([7835aa3](https://github.com/bhaochen/ncopy/commit/7835aa3ad0b7ca3faeb8b8641c02eec689d81056))
* **ui:** replace Inter and Source Serif 4 with Nunito as sole typeface ([#167](https://github.com/bhaochen/ncopy/issues/167)) ([f95a614](https://github.com/bhaochen/ncopy/commit/f95a6142d14f6c4ef97975ead8424992c3035a04))
* update /searchimage prompt so model knows gallery is UI-rendered ([0fb0c67](https://github.com/bhaochen/ncopy/commit/0fb0c6700c105477bb9ac74da620e9766bd44516))
* **updater:** clear snoozes when a new version becomes available ([#149](https://github.com/bhaochen/ncopy/issues/149)) ([a224b3b](https://github.com/bhaochen/ncopy/commit/a224b3b6b15513d56636b7c8a72915dec9d75620))
* **updater:** embed full release changelog in updater manifest ([#182](https://github.com/bhaochen/ncopy/issues/182)) ([f9ec2b5](https://github.com/bhaochen/ncopy/commit/f9ec2b594f790eb41f26443a1dcb5977cf590ead))
* **updater:** relaunch after TCC reset so System Settings can re-register Thuki ([#151](https://github.com/bhaochen/ncopy/issues/151)) ([92ab812](https://github.com/bhaochen/ncopy/commit/92ab81260a7b6efd9fe2aa9f809ba9ba8cf756e2))
* **updater:** relaunch after TCC reset to refresh tccd PID tracking ([92ab812](https://github.com/bhaochen/ncopy/commit/92ab81260a7b6efd9fe2aa9f809ba9ba8cf756e2))
* **updater:** timestamp on errors and footer in chat mode ([#147](https://github.com/bhaochen/ncopy/issues/147)) ([b303126](https://github.com/bhaochen/ncopy/commit/b303126a9cb0204f0cccb44116731104fe49afd2))
* use GitHub API for Cargo.lock commit to get Verified badge ([#50](https://github.com/bhaochen/ncopy/issues/50)) ([1af15a1](https://github.com/bhaochen/ncopy/commit/1af15a137dbdc7911ac7e45ac312f10f3dcee588))
* use native wheel listener with {passive:false} so preventDefault works ([956775e](https://github.com/bhaochen/ncopy/commit/956775eddc83af7405177765a47464da5c271cca))
* use screen.availHeight (not config) as the chat height cap ([d2d02ed](https://github.com/bhaochen/ncopy/commit/d2d02ed8baef37d4079d0f685bc839d76007f1b8))
* use wheel events for auto-scroll to prevent layout-induced false negatives ([33c3306](https://github.com/bhaochen/ncopy/commit/33c3306b5f5f36e037391e4a3f7929c17e274a1f))
* **window:** dock icon + normal layering for Settings and onboarding ([#273](https://github.com/bhaochen/ncopy/issues/273)) ([91eb3b9](https://github.com/bhaochen/ncopy/commit/91eb3b959c173f215d04ce86c76239aef14d494c))
* **window:** hide Dock icon on Settings close and refocus without recentering ([7835aa3](https://github.com/bhaochen/ncopy/commit/7835aa3ad0b7ca3faeb8b8641c02eec689d81056))
* **windows:** make Settings and What's New standard single-Space windows ([#283](https://github.com/bhaochen/ncopy/issues/283)) ([1887bb4](https://github.com/bhaochen/ncopy/commit/1887bb4fd80630650903bb3af20aecf5d61ebad4))
* wire Auto search learn URL to disclosure blog post ([#335](https://github.com/bhaochen/ncopy/issues/335)) ([7b160db](https://github.com/bhaochen/ncopy/commit/7b160dbe36d8a9590fafa18e6a867669db2b0d81))


### Reverts

* hold Providers setting out of the next release ([#208](https://github.com/bhaochen/ncopy/issues/208)) ([5de373c](https://github.com/bhaochen/ncopy/commit/5de373c16d2fbf8ab43a104acbaced6993986e92))
* restore onboarding permission-revocation detection ([#231](https://github.com/bhaochen/ncopy/issues/231)) ([#232](https://github.com/bhaochen/ncopy/issues/232)) ([fecc887](https://github.com/bhaochen/ncopy/commit/fecc887b27aa3e93c00233d0896b4f09df86c1c0))


### Miscellaneous Chores

* release 0.15.2 ([99a13ad](https://github.com/bhaochen/ncopy/commit/99a13ad5085c2c4f01f2e7356367e48ffb7b6ca3))

## [0.16.2](https://github.com/quiet-node/thuki/compare/v0.16.1...v0.16.2) (2026-07-21)


### Bug Fixes

* **prompt:** stop base system prompt forcing language guesses on all providers ([#350](https://github.com/quiet-node/thuki/issues/350)) ([bfaa8f9](https://github.com/quiet-node/thuki/commit/bfaa8f95d6ed551c926ee84c394deed761bdc2a0))

## [0.16.1](https://github.com/quiet-node/thuki/compare/v0.16.0...v0.16.1) (2026-07-18)


### Bug Fixes

* **models:** remember per-model memory-fit override ([#339](https://github.com/quiet-node/thuki/issues/339)) ([245e185](https://github.com/quiet-node/thuki/commit/245e185b3eebfb8b80156bd2aeb28620257f770c))

## [0.16.0](https://github.com/quiet-node/thuki/compare/v0.15.9...v0.16.0) (2026-07-18)


### Features

* built-in web search with auto-search, citation audit, and progressive trace ([#312](https://github.com/quiet-node/thuki/issues/312)) ([7972b31](https://github.com/quiet-node/thuki/commit/7972b31346f5dd55e4ca396026e26fc974282e1c))
* **ci:** ship Thuki Nightly as side-by-side signed install ([#336](https://github.com/quiet-node/thuki/issues/336)) ([3810dd1](https://github.com/quiet-node/thuki/commit/3810dd15cdff0c22276cd3e71c4347b6394a2253))
* conversation-wide search evidence reuse ([#330](https://github.com/quiet-node/thuki/issues/330)) ([1fe32a4](https://github.com/quiet-node/thuki/commit/1fe32a4769b73a1acae7409b69933c9787853f03))
* cut ForceWeb search latency and harden answer quality ([#324](https://github.com/quiet-node/thuki/issues/324)) ([51d2c1f](https://github.com/quiet-node/thuki/commit/51d2c1f5c281fce61e6ed415f18c7924f034d49b))
* **history:** auto-save chats with retention and free chats ([#331](https://github.com/quiet-node/thuki/issues/331)) ([057b089](https://github.com/quiet-node/thuki/commit/057b089db4df43bc7f4560d3348550812b890717))
* move Diagnostics to Behavior tab with trace retention and folder actions ([#325](https://github.com/quiet-node/thuki/issues/325)) ([70d68ac](https://github.com/quiet-node/thuki/commit/70d68ac489515699c2a2b46d162ffbd64faa2b54))
* search language parity across retrieval and answers ([#326](https://github.com/quiet-node/thuki/issues/326)) ([9005d44](https://github.com/quiet-node/thuki/commit/9005d44ac14538d8f8dffdf74de6ad4c187ad75f))
* search resilience and citation a11y ([#327](https://github.com/quiet-node/thuki/issues/327)) ([e8e2fd7](https://github.com/quiet-node/thuki/commit/e8e2fd73b98ed8d1cea1172d4c33fe88f72c79ae))
* search trust and lawfulness package ([#323](https://github.com/quiet-node/thuki/issues/323)) ([151adf6](https://github.com/quiet-node/thuki/commit/151adf6768b4760039397d51f296f68e9064c4e1))
* **settings:** Changelog tab with full release history ([#328](https://github.com/quiet-node/thuki/issues/328)) ([fd909fe](https://github.com/quiet-node/thuki/commit/fd909feda2c748136591a4629ad6ff852ef71e42))


### Bug Fixes

* **ci:** make engine-gate throughput report-only instead of a blocking floor ([#321](https://github.com/quiet-node/thuki/issues/321)) ([07f1ca8](https://github.com/quiet-node/thuki/commit/07f1ca8afc9f2317395528d6e23371ec0d3e8218))
* disclose when a requested web search can't reach the web or finds nothing ([#314](https://github.com/quiet-node/thuki/issues/314)) ([2a4d749](https://github.com/quiet-node/thuki/commit/2a4d749eb519540573085ef7d035a1ac0e75cd6c))
* **models:** gate browse installs to chat brains only ([07e0b35](https://github.com/quiet-node/thuki/commit/07e0b35eae8d363f3476c3f072e9494a8d397b72))
* **models:** gate Browse installs to chat brains only ([#337](https://github.com/quiet-node/thuki/issues/337)) ([07e0b35](https://github.com/quiet-node/thuki/commit/07e0b35eae8d363f3476c3f072e9494a8d397b72))
* **search:** disclose when a requested web search is unreachable or finds nothing ([2a4d749](https://github.com/quiet-node/thuki/commit/2a4d749eb519540573085ef7d035a1ac0e75cd6c))
* surface the 80% memory headroom rule in the model-fit warning ([#322](https://github.com/quiet-node/thuki/issues/322)) ([a9d5bb4](https://github.com/quiet-node/thuki/commit/a9d5bb4a297ae38a2b0739e28ff5ef22e746e507))
* wire Auto search learn URL to disclosure blog post ([#335](https://github.com/quiet-node/thuki/issues/335)) ([01a99e2](https://github.com/quiet-node/thuki/commit/01a99e28790f916f5ce6d850cb917aae56ef9df9))

## [0.15.9](https://github.com/quiet-node/thuki/compare/v0.15.8...v0.15.9) (2026-07-10)


### Bug Fixes

* harden memory, download, and crash-recovery guardrails ([#306](https://github.com/quiet-node/thuki/issues/306)) ([4f6ef08](https://github.com/quiet-node/thuki/commit/4f6ef084ffd9b3b07a8aef8282db183819725af0))

## [0.15.8](https://github.com/quiet-node/thuki/compare/v0.15.7...v0.15.8) (2026-07-04)


### Bug Fixes

* define missing background theme token for Streamdown table menus ([#292](https://github.com/quiet-node/thuki/issues/292)) ([6100c5d](https://github.com/quiet-node/thuki/commit/6100c5d53fab59156e95ecbe43941c8b804997b1))
* redesign history panel search field and active row indicator ([#294](https://github.com/quiet-node/thuki/issues/294)) ([4252217](https://github.com/quiet-node/thuki/commit/4252217695e9db87c1321e3355221de756d93d08))

## [0.15.7](https://github.com/quiet-node/thuki/compare/v0.15.6...v0.15.7) (2026-07-02)


### Bug Fixes

* cancel in-flight generation when starting a new session ([#289](https://github.com/quiet-node/thuki/issues/289)) ([da432fa](https://github.com/quiet-node/thuki/commit/da432fa2349d411887d7263fa4e8b4ed71b8a0d6))
* skip false starting-up copy when engine is already loaded ([#291](https://github.com/quiet-node/thuki/issues/291)) ([047824c](https://github.com/quiet-node/thuki/commit/047824ce2a8db529665369b98a60dcc017b544f3))

## [0.15.6](https://github.com/quiet-node/thuki/compare/v0.15.5...v0.15.6) (2026-07-01)


### Bug Fixes

* show cold-start loading label during engine warmup ([#287](https://github.com/quiet-node/thuki/issues/287)) ([bf75c42](https://github.com/quiet-node/thuki/commit/bf75c4275476009599e7f63162270ec9db10ea46))

## [0.15.5](https://github.com/quiet-node/thuki/compare/v0.15.4...v0.15.5) (2026-07-01)


### Bug Fixes

* **context:** detect clipboard fallback copy by content, not by change ([#285](https://github.com/quiet-node/thuki/issues/285)) ([89ae62a](https://github.com/quiet-node/thuki/commit/89ae62a33a633e1555dcc1e0171f042fad02765e))

## [0.15.4](https://github.com/quiet-node/thuki/compare/v0.15.3...v0.15.4) (2026-06-30)


### Bug Fixes

* **windows:** make Settings and What's New standard single-Space windows ([#283](https://github.com/quiet-node/thuki/issues/283)) ([0196729](https://github.com/quiet-node/thuki/commit/0196729c8d3ef31a9ff188f692411fb409ca9da6))

## [0.15.3](https://github.com/quiet-node/thuki/compare/v0.15.2...v0.15.3) (2026-06-30)


### Bug Fixes

* **ui:** hide Dock icon on Settings close and refocus without recentering ([#280](https://github.com/quiet-node/thuki/issues/280)) ([ff6e44c](https://github.com/quiet-node/thuki/commit/ff6e44cc5a77e840aa806b4a217d344bf4bbdfbf))
* **window:** hide Dock icon on Settings close and refocus without recentering ([ff6e44c](https://github.com/quiet-node/thuki/commit/ff6e44cc5a77e840aa806b4a217d344bf4bbdfbf))

## [0.15.2](https://github.com/quiet-node/thuki/compare/v0.15.1...v0.15.2) (2026-06-30)


### Features

* **models:** clickable Browse-all quant filenames + non-blocking model delete ([#271](https://github.com/quiet-node/thuki/issues/271)) ([b68c663](https://github.com/quiet-node/thuki/commit/b68c66329ad872da5593fb60c085d68cc9018497))


### Bug Fixes

* **window:** dock icon + normal layering for Settings and onboarding ([#273](https://github.com/quiet-node/thuki/issues/273)) ([a439e5e](https://github.com/quiet-node/thuki/commit/a439e5e10c04b5678ac8f31e55a572ed59addac7))


### Miscellaneous Chores

* release 0.15.2 ([0ddbf68](https://github.com/quiet-node/thuki/commit/0ddbf685935d9ed97a8f12f6bf2b6015d6c369ef))

## [0.15.1](https://github.com/quiet-node/thuki/compare/v0.15.0...v0.15.1) (2026-06-30)


### Bug Fixes

* **ci:** cap engine build parallelism by RAM to avoid OOM stalls ([#270](https://github.com/quiet-node/thuki/issues/270)) ([6904cb2](https://github.com/quiet-node/thuki/commit/6904cb28506782050db00793187492ff31e72274))
* **ci:** cap engine build parallelism by RAM to avoid OOM stalls on CI runners ([6904cb2](https://github.com/quiet-node/thuki/commit/6904cb28506782050db00793187492ff31e72274))
* **ci:** fetch llama-server sidecar before lint in release job ([0824f2c](https://github.com/quiet-node/thuki/commit/0824f2cabb9a34d0ad669e14a0c328008e10e2f2))
* **ci:** fetch llama-server sidecar before lint in release publish job ([#261](https://github.com/quiet-node/thuki/issues/261)) ([0824f2c](https://github.com/quiet-node/thuki/commit/0824f2cabb9a34d0ad669e14a0c328008e10e2f2))
* **downloads:** RAM-fit starter swap, non-blocking sends, cross-window pause/discard sync ([#269](https://github.com/quiet-node/thuki/issues/269)) ([faf681c](https://github.com/quiet-node/thuki/commit/faf681c505781c699afa70ad711149737a451fa1))
* **engine:** support macOS 13.4+ for the built-in engine ([#266](https://github.com/quiet-node/thuki/issues/266)) ([8226773](https://github.com/quiet-node/thuki/commit/8226773290244cf2c2036387aafdc8e0a8ee536f))
* **models:** update UI for multi-part (split) GGUF models ([#267](https://github.com/quiet-node/thuki/issues/267)) ([3c0c1de](https://github.com/quiet-node/thuki/commit/3c0c1de0bdb3262d15df32a2527d536fa594877a))

## [0.15.0](https://github.com/quiet-node/thuki/compare/v0.14.3...v0.15.0) (2026-06-29)


### Features

* built-in engine onboarding, model downloads, Settings providers, and default flip ([#219](https://github.com/quiet-node/thuki/issues/219)) ([171a6a3](https://github.com/quiet-node/thuki/commit/171a6a3dc2212f3a8079b0cee727b2c98b6fc0b3))
* bundled engine runner and model library ([#217](https://github.com/quiet-node/thuki/issues/217)) ([faa82ca](https://github.com/quiet-node/thuki/commit/faa82caba2416327a2992153f8a6bcf2237ea6e2))
* **models:** in-app model library with Discover browser and Staff Picks ([#237](https://github.com/quiet-node/thuki/issues/237)) ([23b32ef](https://github.com/quiet-node/thuki/commit/23b32efc13b615c4d0763e1bc7a09d3bd557f9b1))
* **models:** sync live download progress across windows ([#250](https://github.com/quiet-node/thuki/issues/250)) ([4e14d66](https://github.com/quiet-node/thuki/commit/4e14d6654dc835c3a7380d94368bf37e2e16bbc3))
* **onboarding:** built-in engine upgrade announcement and onboarding/picker polish ([#251](https://github.com/quiet-node/thuki/issues/251)) ([cfc0c62](https://github.com/quiet-node/thuki/commit/cfc0c62e246d4ce1716b95cf0d5c0cf1c3ef6622))
* **onboarding:** optional email capture to help shape Thuki ([#254](https://github.com/quiet-node/thuki/issues/254)) ([b5c6f5c](https://github.com/quiet-node/thuki/commit/b5c6f5cfc98db7341fbaad78395579ea51fcbe8e))
* **onboarding:** surface-aware download strip and model-library intro fact ([#252](https://github.com/quiet-node/thuki/issues/252)) ([f6240bd](https://github.com/quiet-node/thuki/commit/f6240bdeba37c99f7cc5f3745e8992c13b872eb9))
* OpenAI-compatible /v1 client and provider routing ([#218](https://github.com/quiet-node/thuki/issues/218)) ([25fe634](https://github.com/quiet-node/thuki/commit/25fe63480260eb951c01bff632516d379e0d4ab7))
* restore the Providers setting reverted by [#208](https://github.com/quiet-node/thuki/issues/208) ([#215](https://github.com/quiet-node/thuki/issues/215)) ([5a5310f](https://github.com/quiet-node/thuki/commit/5a5310f0ed2668110510bf137d1366061c195ae0))
* **settings:** subtle model-name links with hover reveal ([#255](https://github.com/quiet-node/thuki/issues/255)) ([bcfaa78](https://github.com/quiet-node/thuki/commit/bcfaa781888277fc54d6a56f0740689d19ad386b))
* **settings:** subtle model-name links with hover reveal; italic founder name ([bcfaa78](https://github.com/quiet-node/thuki/commit/bcfaa781888277fc54d6a56f0740689d19ad386b))


### Bug Fixes

* ad-hoc sign local macOS builds so TCC grants apply ([#229](https://github.com/quiet-node/thuki/issues/229)) ([5c3a2df](https://github.com/quiet-node/thuki/commit/5c3a2dfd4f65b1cfce36a447ad0f9a86a34721dd))
* fetch llama-server sidecar before lint in nightly release ([#235](https://github.com/quiet-node/thuki/issues/235)) ([d039999](https://github.com/quiet-node/thuki/commit/d03999935eebbe84ec37312976f638d4559fedd8))
* gate overlay activation during onboarding to prevent window collapse ([#233](https://github.com/quiet-node/thuki/issues/233)) ([b111b1c](https://github.com/quiet-node/thuki/commit/b111b1c36210a932d3489e4d7748f4cd953a59e2))
* onboarding permission loop on local macOS builds ([#230](https://github.com/quiet-node/thuki/issues/230)) ([5c3a2df](https://github.com/quiet-node/thuki/commit/5c3a2dfd4f65b1cfce36a447ad0f9a86a34721dd))
* persist onboarding progress so relaunch can't bounce permissions ([#229](https://github.com/quiet-node/thuki/issues/229)) ([a0ecbbb](https://github.com/quiet-node/thuki/commit/a0ecbbb43e3b650a618816ed4cf352dd8d153b34))
* **prompt:** stop model from emitting slash commands as replies ([#243](https://github.com/quiet-node/thuki/issues/243)) ([fa08c8c](https://github.com/quiet-node/thuki/commit/fa08c8c712efe1464d6ef93713fe0e555a24a905))
* regain overlay focus after defocus via hover-activate tracking area ([#234](https://github.com/quiet-node/thuki/issues/234)) ([dec7535](https://github.com/quiet-node/thuki/commit/dec75354d4c779ef5a7b5c4d42cdae1325ad82e7))
* trim the system prompt and refresh non-customized prompts on load ([#239](https://github.com/quiet-node/thuki/issues/239)) ([395c77b](https://github.com/quiet-node/thuki/commit/395c77ba624f097107eec354904cad0a587d3e29))


### Reverts

* restore onboarding permission-revocation detection ([#231](https://github.com/quiet-node/thuki/issues/231)) ([#232](https://github.com/quiet-node/thuki/issues/232)) ([1f8a121](https://github.com/quiet-node/thuki/commit/1f8a12182f39309c646e41ccd2eec8bdd9deaee1))

## [0.14.3](https://github.com/quiet-node/thuki/compare/v0.14.2...v0.14.3) (2026-06-09)


### Bug Fixes

* emit terminal Done when the model stream ends without a done marker ([#212](https://github.com/quiet-node/thuki/issues/212)) ([df09b2a](https://github.com/quiet-node/thuki/commit/df09b2a029b34cf2e0241790fc0f1618c0ac55be))

## [0.14.2](https://github.com/quiet-node/thuki/compare/v0.14.1...v0.14.2) (2026-06-08)


### Bug Fixes

* make /rewrite preserve formatting, structure, and verbatim content ([#207](https://github.com/quiet-node/thuki/issues/207)) ([d3d2edb](https://github.com/quiet-node/thuki/commit/d3d2edb36728dcb5664711f3034bf70cb749aec0))

## [0.14.1](https://github.com/quiet-node/thuki/compare/v0.14.0...v0.14.1) (2026-06-07)


### Bug Fixes

* show all versions between installed and latest in What's New ([#203](https://github.com/quiet-node/thuki/issues/203)) ([792b098](https://github.com/quiet-node/thuki/commit/792b098e6e2c4edef2f2525a3b98f8721787385b))

## [0.14.0](https://github.com/quiet-node/thuki/compare/v0.13.1...v0.14.0) (2026-06-07)


### Features

* allow drafting messages while response is streaming in AskBarView ([#200](https://github.com/quiet-node/thuki/issues/200)) ([108e1eb](https://github.com/quiet-node/thuki/commit/108e1eb3e367778b24e41b6e1be096647eadbf6c))
* migrate AskBar input to Lexical to fix WKWebView caret drift ([#202](https://github.com/quiet-node/thuki/issues/202)) ([adafe47](https://github.com/quiet-node/thuki/commit/adafe4729f55e898bba46607d527f629b60bace9))
* pre-load conversation list before opening ask-bar history drawer ([#199](https://github.com/quiet-node/thuki/issues/199)) ([5ac73e0](https://github.com/quiet-node/thuki/commit/5ac73e0bdbcfedfef454842671b70d275d77da70))
* redesign /rewrite for a natural, casual voice ([#201](https://github.com/quiet-node/thuki/issues/201)) ([c66519a](https://github.com/quiet-node/thuki/commit/c66519a71d3557e73b9f3f2c1e027435a8cca232))
* write /rewrite and /refine results back into the source app ([#197](https://github.com/quiet-node/thuki/issues/197)) ([03a8fce](https://github.com/quiet-node/thuki/commit/03a8fce0c2c136a2e98638315b4cebb298e1f84d))

## [0.13.1](https://github.com/quiet-node/thuki/compare/v0.13.0...v0.13.1) (2026-05-26)


### Bug Fixes

* **screenshot:** capture display containing Thuki window on multi-monitor setups ([#191](https://github.com/quiet-node/thuki/issues/191)) ([611dff1](https://github.com/quiet-node/thuki/commit/611dff1d2b57a1bac709cbc227f0f98615b3d7be))

## [0.13.0](https://github.com/quiet-node/thuki/compare/v0.12.0...v0.13.0) (2026-05-25)


### Features

* export chat session to Markdown and clipboard ([#189](https://github.com/quiet-node/thuki/issues/189)) ([e8eeed0](https://github.com/quiet-node/thuki/commit/e8eeed05a61babd9e4efd190afb7d97f46f99658))

## [0.12.0](https://github.com/quiet-node/thuki/compare/v0.11.3...v0.12.0) (2026-05-22)


### Features

* **minimize:** collapse the chat to a floating mascot with edge-aware restore ([#187](https://github.com/quiet-node/thuki/issues/187)) ([23507c0](https://github.com/quiet-node/thuki/commit/23507c0d111ff879cde30e67687726e9f177a08f))

## [0.11.3](https://github.com/quiet-node/thuki/compare/v0.11.2...v0.11.3) (2026-05-18)


### Bug Fixes

* **updater:** embed full release changelog in updater manifest ([#182](https://github.com/quiet-node/thuki/issues/182)) ([6462266](https://github.com/quiet-node/thuki/commit/646226691fb8ebb9912d38327909d2f328d67d7b))

## [0.11.2](https://github.com/quiet-node/thuki/compare/v0.11.1...v0.11.2) (2026-05-18)


### Bug Fixes

* **math:** escape currency dollars so they aren't parsed as LaTeX math ([#180](https://github.com/quiet-node/thuki/issues/180)) ([90faee1](https://github.com/quiet-node/thuki/commit/90faee18535e58eb25df6f5310f07ccb1da4a9d3))

## [0.11.1](https://github.com/quiet-node/thuki/compare/v0.11.0...v0.11.1) (2026-05-16)


### UI

* **updater:** redesign the What's New window to match the Settings panel ([#177](https://github.com/quiet-node/thuki/issues/177)) ([9f80719](https://github.com/quiet-node/thuki/commit/9f80719234913e423d7025cc4a976d6b823c0459))

## [0.11.0](https://github.com/quiet-node/thuki/compare/v0.10.0...v0.11.0) (2026-05-16)


### Features

* **updater:** What's New update window with explicit actions; open Settings on current Space ([#174](https://github.com/quiet-node/thuki/issues/174)) ([0243c4b](https://github.com/quiet-node/thuki/commit/0243c4b568980b6b35441cf55065ac2d0993c7d4))

## [0.10.0](https://github.com/quiet-node/thuki/compare/v0.9.1...v0.10.0) (2026-05-15)


### Features

* **settings:** user-configurable typography controls for chat and input ([#172](https://github.com/quiet-node/thuki/issues/172)) ([03e523c](https://github.com/quiet-node/thuki/commit/03e523ce98d77ae5ee435602c6102a8aed542163))

## [0.9.1](https://github.com/quiet-node/thuki/compare/v0.9.0...v0.9.1) (2026-05-13)


### Bug Fixes

* **ui:** replace Inter and Source Serif 4 with Nunito as sole typeface ([#167](https://github.com/quiet-node/thuki/issues/167)) ([fec2c49](https://github.com/quiet-node/thuki/commit/fec2c494ef893b29fe36692bb3f672b6b21574f7))

## [0.9.0](https://github.com/quiet-node/thuki/compare/v0.8.5...v0.9.0) (2026-05-12)


### Features

* **commands:** add /explain slash command with /screen and image support ([#159](https://github.com/quiet-node/thuki/issues/159)) ([b78e9b3](https://github.com/quiet-node/thuki/commit/b78e9b3664cf8f8d1031f7b84778f9c563ed1c3f))
* **commands:** add /extract slash command with Vision OCR text extraction ([#160](https://github.com/quiet-node/thuki/issues/160)) ([aafe2fc](https://github.com/quiet-node/thuki/commit/aafe2fc2054615639a7a88803b18c6947d749edd))
* **commands:** unified slash command dispatch + OCR utility commands ([#164](https://github.com/quiet-node/thuki/issues/164)) ([22fc98f](https://github.com/quiet-node/thuki/commit/22fc98fb021fafec64182882eed3b7a8133e73e5))
* **markdown:** add KaTeX math rendering via Streamdown plugin API ([#156](https://github.com/quiet-node/thuki/issues/156)) ([579a93b](https://github.com/quiet-node/thuki/commit/579a93bef0c7d513adf8550cb1d8a1ff41b580c3))


### Bug Fixes

* **config:** restore default system prompt on upgrade for uncustomized configs ([#158](https://github.com/quiet-node/thuki/issues/158)) ([43e0386](https://github.com/quiet-node/thuki/commit/43e03863082cc59c4340ab9cd2d313aaeefe4f62))

## [0.8.5](https://github.com/quiet-node/thuki/compare/v0.8.4...v0.8.5) (2026-05-08)


### Bug Fixes

* **permissions:** clear stale TCC entries on upgrade and grant click ([#153](https://github.com/quiet-node/thuki/issues/153)) ([f6d9ca2](https://github.com/quiet-node/thuki/commit/f6d9ca2c9e8ffce8299be633f6a7d4338e990841))

## [0.8.4](https://github.com/quiet-node/thuki/compare/v0.8.3...v0.8.4) (2026-05-07)


### Bug Fixes

* **updater:** relaunch after TCC reset so System Settings can re-register Thuki ([#151](https://github.com/quiet-node/thuki/issues/151)) ([27dc003](https://github.com/quiet-node/thuki/commit/27dc0031b06da23dcc72de8183f59cb5e790ab2b))
* **updater:** relaunch after TCC reset to refresh tccd PID tracking ([27dc003](https://github.com/quiet-node/thuki/commit/27dc0031b06da23dcc72de8183f59cb5e790ab2b))

## [0.8.3](https://github.com/quiet-node/thuki/compare/v0.8.2...v0.8.3) (2026-05-07)


### Bug Fixes

* **updater:** clear snoozes when a new version becomes available ([#149](https://github.com/quiet-node/thuki/issues/149)) ([c672409](https://github.com/quiet-node/thuki/commit/c6724095663b51ce2cce38b6410d668a53c10f40))

## [0.8.2](https://github.com/quiet-node/thuki/compare/v0.8.1...v0.8.2) (2026-05-07)


### Bug Fixes

* **updater:** timestamp on errors and footer in chat mode ([#147](https://github.com/quiet-node/thuki/issues/147)) ([92a2e15](https://github.com/quiet-node/thuki/commit/92a2e151e5437868b48d56470b36192596a8f890))

## [0.8.1](https://github.com/quiet-node/thuki/compare/v0.8.0...v0.8.1) (2026-05-07)


### Bug Fixes

* **settings:** redesign About Updates as hero card with check animation ([#145](https://github.com/quiet-node/thuki/issues/145)) ([b4190e1](https://github.com/quiet-node/thuki/commit/b4190e1958b72dd83334aa6f48430dcee644547a))

## [0.8.0](https://github.com/quiet-node/thuki/compare/v0.7.1...v0.8.0) (2026-05-07)


### Features

* **trace:** unified per-conversation forensic recorder for chat + search ([#139](https://github.com/quiet-node/thuki/issues/139)) ([76f9180](https://github.com/quiet-node/thuki/commit/76f91802ac248e5acd210721f20dc233654b5d9d))
* **updater:** in-app auto-update via signed GitHub releases ([#144](https://github.com/quiet-node/thuki/issues/144)) ([7e5b833](https://github.com/quiet-node/thuki/commit/7e5b833eed2aee45c1614aa4b36b1b8671b0e152))


### Bug Fixes

* **ui:** adopt Source Serif 4 for AI prose reading register ([#140](https://github.com/quiet-node/thuki/issues/140)) ([5adc86d](https://github.com/quiet-node/thuki/commit/5adc86dfa1ad91b5358df1b381bcca7c0b9d6e10))

## [0.7.1](https://github.com/quiet-node/thuki/compare/v0.7.0...v0.7.1) (2026-05-04)


### Bug Fixes

* **settings:** repair keep-warm minutes input UX ([#127](https://github.com/quiet-node/thuki/issues/127)) ([38b506c](https://github.com/quiet-node/thuki/commit/38b506cdd817b728387bf0c864c15e23eb62844b))

## [0.7.0](https://github.com/quiet-node/thuki/compare/v0.6.1...v0.7.0) (2026-05-04)


### Features

* add utility slash commands ([#93](https://github.com/quiet-node/thuki/issues/93)) ([98a3a19](https://github.com/quiet-node/thuki/commit/98a3a196710edfbd99c9860753fea5cbfaf9c28b))
* **ci:** add floating nightly release workflow ([#109](https://github.com/quiet-node/thuki/issues/109)) ([c213235](https://github.com/quiet-node/thuki/commit/c2132358da02428d77b43a4e288f4dc987782ca2))
* **config:** make max_images user-tunable with a cap of 20 ([#121](https://github.com/quiet-node/thuki/issues/121)) ([4e1b3af](https://github.com/quiet-node/thuki/commit/4e1b3afbbf3c2caa116e84bfdedd5cec941709a6))
* **config:** migrate runtime configuration from env vars to TOML ([#102](https://github.com/quiet-node/thuki/issues/102)) ([20abeb0](https://github.com/quiet-node/thuki/commit/20abeb025655159f9ad5bcc4287ea8f76eda6026))
* **config:** user-tunable context window with log-scale slider ([#120](https://github.com/quiet-node/thuki/issues/120)) ([1c18ddf](https://github.com/quiet-node/thuki/commit/1c18ddf56ea50607fe034945f38d79edd123d885))
* **continuity:** cross-model history sanitization and capability-aware filtering ([#107](https://github.com/quiet-node/thuki/issues/107)) ([c976d63](https://github.com/quiet-node/thuki/commit/c976d63a6b8b1f9ac171fd988ec54260dba3beae))
* in-app model picker with hardened selection pipeline ([#103](https://github.com/quiet-node/thuki/issues/103)) ([d6cf4fb](https://github.com/quiet-node/thuki/commit/d6cf4fb576e72029834d53c12a844fed6a41a975))
* introduce agentic search pipeline with live trace streaming ([#100](https://github.com/quiet-node/thuki/issues/100)) ([445534f](https://github.com/quiet-node/thuki/commit/445534f0835ebe8b2e60e8d6a6f741b052534215))
* **model-picker:** add larger-models nudge hint ([#118](https://github.com/quiet-node/thuki/issues/118)) ([6c0df18](https://github.com/quiet-node/thuki/commit/6c0df189450ac1eb21dfe2d8d571c1ec9e48b8af))
* **search:** add forensic trace recorder ([#126](https://github.com/quiet-node/thuki/issues/126)) ([e1d5997](https://github.com/quiet-node/thuki/commit/e1d5997572150b1b8a77c1c0b4a50943656dddb1))
* sync slash command docs and prompt metadata ([#101](https://github.com/quiet-node/thuki/issues/101)) ([7501d60](https://github.com/quiet-node/thuki/commit/7501d601d5fe83e33778737a68a84b9fcb968e03))
* **tray:** left-click opens Thuki, right-click shows menu ([#123](https://github.com/quiet-node/thuki/issues/123)) ([81f133e](https://github.com/quiet-node/thuki/commit/81f133e1f2a8c04a151caefbaf8f673a53969284))
* **ui:** add tip bar with contextual usage tips ([#119](https://github.com/quiet-node/thuki/issues/119)) ([ed9b250](https://github.com/quiet-node/thuki/commit/ed9b2504c98fd95a90395c4fe398367872c8f15d))


### Bug Fixes

* **chat:** prevent source-row clicks from opening URL twice ([#104](https://github.com/quiet-node/thuki/issues/104)) ([e1d2cdf](https://github.com/quiet-node/thuki/commit/e1d2cdf85c2f81219784536779cd7048340df2fa))
* **ci:** set VITE_GIT_COMMIT_SHA on tauri build step not frontend step ([#111](https://github.com/quiet-node/thuki/issues/111)) ([ed80d15](https://github.com/quiet-node/thuki/commit/ed80d151f907313c44be6d92cf2017be3c78d802))
* **search:** correct Setup Guide anchor in sandbox-offline card ([#112](https://github.com/quiet-node/thuki/issues/112)) ([29f2c1f](https://github.com/quiet-node/thuki/commit/29f2c1f2af7e2c8631e40d336b8735e5c8acbdcd))
* **search:** harden judge fallback and config allowlist ([#125](https://github.com/quiet-node/thuki/issues/125)) ([cf82a95](https://github.com/quiet-node/thuki/commit/cf82a95f722573cd282a2ffec3c2e94e84e9ec12))
* **settings:** allow text selection in settings panel ([#122](https://github.com/quiet-node/thuki/issues/122)) ([5c552cb](https://github.com/quiet-node/thuki/commit/5c552cb9782636b359b0ee7d1c95de5b5bc83350))
* **settings:** eliminate Dock icon by converting settings window to NSPanel ([#117](https://github.com/quiet-node/thuki/issues/117)) ([217fa00](https://github.com/quiet-node/thuki/commit/217fa00ef4b570cadda33d44d44e2c3ef65fcedd))

## [0.6.1](https://github.com/quiet-node/thuki/compare/v0.6.0...v0.6.1) (2026-04-14)


### Bug Fixes

* intercept drops at root level and add max-images UX feedback ([#90](https://github.com/quiet-node/thuki/issues/90)) ([c304af8](https://github.com/quiet-node/thuki/commit/c304af8e1ffc32567228bd6910ecacdad1150991))

## [0.6.0](https://github.com/quiet-node/thuki/compare/v0.5.2...v0.6.0) (2026-04-14)


### Features

* add /think command with thinking mode UI ([#85](https://github.com/quiet-node/thuki/issues/85)) ([59f7333](https://github.com/quiet-node/thuki/commit/59f7333335a55a896209b5c7756368988b80cf49))

## [0.5.2](https://github.com/quiet-node/thuki/compare/v0.5.1...v0.5.2) (2026-04-12)


### Bug Fixes

* enlarge close button hit area to fix unreliable click ([#82](https://github.com/quiet-node/thuki/issues/82)) ([a829858](https://github.com/quiet-node/thuki/commit/a829858b8458e70fa704c0174e0589cdb4728feb))

## [0.5.1](https://github.com/quiet-node/thuki/compare/v0.5.0...v0.5.1) (2026-04-10)


### Bug Fixes

* cancel active streaming on overlay hide and app quit ([#73](https://github.com/quiet-node/thuki/issues/73)) ([077893a](https://github.com/quiet-node/thuki/commit/077893aa6252d8dbf967c82ffd1aa1e5af39b32c))
* preserve scroll position when streaming finishes ([#70](https://github.com/quiet-node/thuki/issues/70)) ([4254ea2](https://github.com/quiet-node/thuki/commit/4254ea20afa7a4341c87efc6ceeda59686bc35f7))
* replace anchor system with simple screen-bottom growth detection ([#74](https://github.com/quiet-node/thuki/issues/74)) ([d59119d](https://github.com/quiet-node/thuki/commit/d59119d1da2a47b80a3c0747ffea9d1d5d78df98))

## [0.5.0](https://github.com/quiet-node/thuki/compare/v0.4.0...v0.5.0) (2026-04-08)


### Features

* friendly error UI for Ollama not running / model not found ([#61](https://github.com/quiet-node/thuki/issues/61)) ([6426ea2](https://github.com/quiet-node/thuki/commit/6426ea26e96eb985fa942b68fc8570bdee984159))
* improve context awareness and image handling for better multimodal understanding ([7f64352](https://github.com/quiet-node/thuki/commit/7f643525bceb25154d481c6dd4aa78f4dce89460))
* onboarding flow with permission-gated stage machine ([#65](https://github.com/quiet-node/thuki/issues/65)) ([35497cb](https://github.com/quiet-node/thuki/commit/35497cb8b1ceb7f10533b6323a3c68a8dd361b1b))
* overhaul system prompt and move to dedicated file ([#64](https://github.com/quiet-node/thuki/issues/64)) ([c831c66](https://github.com/quiet-node/thuki/commit/c831c66dcc96a87aed1767eed3093cced4a5db66))
* upgrade to Gemma4 and add runtime model configuration ([#63](https://github.com/quiet-node/thuki/issues/63)) ([5138eac](https://github.com/quiet-node/thuki/commit/5138eac6826fcf94009d8f2a31fe7c37a06cbd9a))


### Bug Fixes

* remove Input Monitoring and suppress native permission popups ([#68](https://github.com/quiet-node/thuki/issues/68)) ([89f06b8](https://github.com/quiet-node/thuki/commit/89f06b87d832dd4acc13de2cba598e7e91135170))
* restore cross-app hotkey via HID tap + active tap options ([#66](https://github.com/quiet-node/thuki/issues/66)) ([8c7f2cd](https://github.com/quiet-node/thuki/commit/8c7f2cd34a42665b6c2b21b8a2beafe2e7f6b76d))

## [0.4.0](https://github.com/quiet-node/thuki/compare/v0.3.0...v0.4.0) (2026-04-07)


### Features

* onboarding screen for macOS permission setup ([#54](https://github.com/quiet-node/thuki/issues/54)) ([d42ae2a](https://github.com/quiet-node/thuki/commit/d42ae2ad00752bafcd95ac7872673ca754fd3e50))


### Bug Fixes

* revert Cargo.lock sync commit to plain git push ([#52](https://github.com/quiet-node/thuki/issues/52)) ([904cdf4](https://github.com/quiet-node/thuki/commit/904cdf44343767d342240712ddc9a43263580af5))

## [0.3.0](https://github.com/quiet-node/thuki/compare/v0.2.1...v0.3.0) (2026-04-06)


### Features

* show AskBar automatically on app launch ([#48](https://github.com/quiet-node/thuki/issues/48)) ([66c994c](https://github.com/quiet-node/thuki/commit/66c994ca75cb71afa6a87e7a3ca9d04eb78e2c9b))


### Bug Fixes

* add Signed-off-by to release-please and Cargo.lock sync commits ([#45](https://github.com/quiet-node/thuki/issues/45)) ([2943f20](https://github.com/quiet-node/thuki/commit/2943f2000f5198a063a164cdd89eeeb5814eb912))
* move signoff to top-level in release-please config ([#47](https://github.com/quiet-node/thuki/issues/47)) ([5a7d076](https://github.com/quiet-node/thuki/commit/5a7d076a196620af6839dd2e9cca9de8e2329d24))
* sync Cargo.lock on release PRs via release workflow ([#43](https://github.com/quiet-node/thuki/issues/43)) ([18f49a4](https://github.com/quiet-node/thuki/commit/18f49a40a3fb944a15beddbc9d1b8c73837add23))
* use GitHub API for Cargo.lock commit to get Verified badge ([#50](https://github.com/quiet-node/thuki/issues/50)) ([cf09593](https://github.com/quiet-node/thuki/commit/cf0959330ebb74b433f35d7ba439b087dd67aeb8))

## [0.2.1](https://github.com/quiet-node/thuki/compare/v0.2.0...v0.2.1) (2026-04-05)


### Bug Fixes

* resolve production screenshot bugs (CSP blob URLs, black screen) ([#41](https://github.com/quiet-node/thuki/issues/41)) ([39da9e8](https://github.com/quiet-node/thuki/commit/39da9e8f87db2ab575c480e71531b0555fa6a8b6))
* sync Cargo.lock to reflect 0.2.0 version bump ([ca17e83](https://github.com/quiet-node/thuki/commit/ca17e83a6bef8de61d5d5dd5cb6a6fc8a049f1ba))

## [0.2.0](https://github.com/quiet-node/thuki/compare/v0.1.0...v0.2.0) (2026-04-05)


### Features

* add /screen slash command with tab-completion and screen capture ([#35](https://github.com/quiet-node/thuki/issues/35)) ([354403a](https://github.com/quiet-node/thuki/commit/354403a9c20eb33e2829de7aece5285cc72fb75a))


### Bug Fixes

* macOS distribution improvements (signing, DMG installer, permissions) ([#36](https://github.com/quiet-node/thuki/issues/36)) ([72b503c](https://github.com/quiet-node/thuki/commit/72b503c7cae2bc50c131d6a8ac12a91c7b56e6d6))

## [0.1.0] - 2026-04-05

### Added

- Floating overlay activated by double-tapping the Control key from any app
- Streaming chat powered by locally running Ollama models
- Multi-turn conversation with full context retention
- Conversation history with SQLite persistence; revisit and continue past sessions
- Image and screenshot input: paste or drag images directly into the chat
- Docker sandbox with capability dropping, read-only model volume, and localhost-only networking
- macOS NSPanel integration for fullscreen-app overlay
- Tray icon with show/hide and quit controls
- Automatic window resizing driven by content height
- Markdown rendering via Streamdown with XSS protection
- Cancel in-flight generation with a stop button
- History panel with search, save/unsave, and conversation switching

[Unreleased]: https://github.com/quiet-node/thuki/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/quiet-node/thuki/releases/tag/v0.1.0
