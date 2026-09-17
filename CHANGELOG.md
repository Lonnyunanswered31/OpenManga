# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Published container images track tagged releases.

## [Unreleased]

First public release. Everything below is the state of the project at the point it was opened up, so the list is
longer than a normal release entry; later entries will only cover what changed.

### Upgrading

Two changes affect anyone who ran this before it was public:

- **Session cookies are renamed.** Every existing session and CSRF cookie is invalidated, so **everyone has to log in
  again once** after upgrading. No data is affected.
- **Renamed to OpenManga.** Compose defaults for the database name and user, the compose networks and the queue key
  prefix all changed with it. Drain the queues before upgrading, and to keep an existing database and asset volumes
  set `COMPOSE_PROJECT_NAME`, `POSTGRES_USER` and `POSTGRES_DB` to their old values in `.env`.
- **Registration is now closed by default.** Set `REGISTRATION_ENABLED=true` to restore open sign-up; otherwise
  create accounts with `bun admin:create` or `INITIAL_ADMIN_*`.
- **Server-level provider keys are gone.** Text and image generation is bring-your-own-key only. If you were relying
  on a provider key in the server environment, add it as a credential in the app instead; the environment variables
  for provider keys are no longer read.

### Added

- Project wizard: details, format (comic pages or 16:9 film shots), style preset, story input, AI analysis, editable
  review and apply.
- Story editor with immutable revisions, AI rewrite into new revisions, and analyses per revision.
- Cast and world: character bibles with aliases, outfits and versions (draft → approved → locked → superseded),
  locations, props, style presets and custom style versions, with generated or uploaded references and explicit panel
  migration between character versions.
- Chapter planning into scenes, beats, pages with deterministic layout templates, and panel specs with auto-placed
  dialogue.
- Page editor on Konva: panel and bubble transforms, zoom and pan, undo/redo, template swap, add/duplicate/split/
  reorder, crop and focal point, mask painting for targeted edits, version compare/activate/revert, and a prompt and
  reference inspector that shows exactly what was sent.
- Generation queue with live progress over SSE, cost and latency reporting, retry and cancel, and bulk page, scene and
  chapter generation behind a cost confirmation.
- Bring-your-own-key provider credentials with rotation, per-project budgets, batch pause, and a readiness gate before
  exports.
- Narration: AI narration text, segment split and merge, voice selection and preview, local Kokoro synthesis, cache
  reuse, chapter playback and a timeline manifest. Multi-language narration.
- OpenAI TTS as a cloud voice alternative to local Kokoro, with the voice list filtered per model.
- Exports: PNG and JPG page sequences, PDF with page size, margin, bleed, DPI and RTL options, webtoon strips with
  chunking, a narration audio package with timeline, project JSON (`schemaVersion: 1`) and a full ZIP package.
- Video export: Ken Burns rendering with SRT subtitles, at panel-cut and page-cut granularity, for a page, a chapter
  or a whole project, plus in-browser preview of chapters, pages and panels.
- Film mode: projects whose pages are single full-bleed 16:9 shots, exported as video.
- Project import from exported JSON.
- Character consistency check across a chapter.
- Cost dashboard with today, 7-day, 30-day and lifetime views, operation breakdowns, reference-size experiments and
  regeneration and acceptance rates. Spend is also reported per provider with an image and text split.
- Preflight check before generation: harm vocabulary, distress lighting and stale references.
- Admin surfaces: users, jobs, queues, Kokoro status, storage, errors, rate snapshots and maintenance.
- Spend that could not be priced is now counted and shown. A call against a model with no rate snapshot records
  $0, so the budget cap could not see it; the budget card, bulk estimate and usage dashboard now say how many
  calls are unpriced, `ai_usage` stores the image and character counts behind each cost, and speech providers can
  be priced per character.
- `IMPORT_MAX_UPLOAD_MB`, `IMPORT_MAX_ENTRY_MB` and `IMPORT_MAX_COMPRESSION_RATIO` make the project-import ceiling
  an operator decision. Packages are now streamed to disk entry by entry rather than held in memory, so a 1.66 GB
  package imports with about 130 MB of worker memory, and the zip-bomb defence is a compression-ratio guard applied
  as chunks arrive instead of an absolute size cap. Raising the upload limit means raising `client_max_body_size`
  on the import route in nginx to match.
- `bun db:seed --samples <url|path>` imports published sample project packages (real artwork and narration)
  through the normal import path, verifying each against `--sha256`.
- `AI_MOCK_MODE` with a mock provider service, so the whole pipeline runs with no provider keys and no spend.

### Changed

- Prompt quality pass: character and location bibles describe what is drawable, panel prompts describe a single
  moment, narration reads as prose rather than captions, and full-bleed images are prompted as full-bleed.
- Video and ZIP exports stream through disk instead of being assembled in memory, so large chapters no longer depend
  on available RAM.
- Unparseable model JSON is recovered where possible instead of failing the job outright.
- Provider content-management filter responses are classified as `content_policy` rather than as generic errors.
- Kokoro synthesis and video rendering run with bounded concurrency.
- Narration pauses are configurable, and the TTS breath between shots dropped from 400 ms to 150 ms.
- The style preset `minimal-anime` keeps location features instead of flattening them away.
- Assets stay on local disk; there is no object-storage backend. Recorded as a deliberate decision rather than a gap.
- New projects start with a $5 spend cap instead of none. Existing projects are untouched, and the cap asks for
  confirmation rather than refusing outright.
- Model rate table corrected for DeepSeek, with rates added for the current OpenAI text models.

### Removed

- Server-held provider keys for Meta, Google, OpenAI and DeepSeek, and the "server default" option in the model
  picker. Provider access is bring-your-own-key only.

### Fixed

- Exporting a project and importing it back no longer loses panel prop pins, asset approval status, narration
  pauses, outfit links, page status and reading-direction overrides, or story revision locks, and imported rows
  keep their artwork version order.
- A job redelivered after a worker restart is finished from the output it already produced instead of calling the
  provider a second time.
- Two clicks on a single panel or narration segment no longer queue two paid jobs, and a batch whose over-budget
  confirmation was given no longer pauses itself on the first job.

- Colour projects no longer receive contradictory art direction. A style preset's monochrome colour policy and
  screentone lines were being sent a few lines away from the project's "full colour" directive, leaving the model to
  choose between them; the project's colour mode now wins and the conflicting preset lines are dropped.
- `content_policy`, `invalid_json` and `invalid_response` failures use their retry budget instead of failing
  immediately. Measured across a 50-project run, every failure of these kinds succeeded on a plain retry, so treating
  them as terminal was discarding work that would have completed.
- A second retry of the same generation record is refused, and retries are tracked through
  `generation_jobs.retried_by_job_id`.
- A chapter plan is refused while another plan for the same chapter is still running, which was producing doubled
  panels.
- `video_pages` export no longer produces a static, pillarboxed result for `format: "film"` projects. The page cut now
  fills the frame for 16:9 pages.
- Dead air in narrated video. TTS voices pad every segment with leading and trailing silence, which stacked with the
  composed pause at each cut and left roughly 1.2 s of silence at every shot change — measured at 24.6% of a narrated
  film. Segments are now silence-trimmed when stored, audio synthesized before trimming is not reused from cache, and
  the configured segment pause and video breath are the only pauses at a cut.
- The narration timeline total no longer counts the pause after the final segment.
- A project ZIP whose contents sit inside a single wrapper directory now imports. That is the shape GitHub's
  "Download ZIP" produces, so a project published as a browsable repository imports without repacking.
- A ZIP package export fails instead of writing a zero-byte entry when an asset cannot be read from storage,
  which used to produce a package that imported "successfully" with empty images.
- Signing in no longer crashes when the server holds no provider keys: the app shell and the admin overview read
  the server's own text and image providers, which are null under bring-your-own-key.
