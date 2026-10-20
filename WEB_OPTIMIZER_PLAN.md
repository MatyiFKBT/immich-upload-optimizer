# Immich Web Media Optimizer — Implementation Plan

## Goal

Add a separately deployable, minimal web interface to search an existing Immich instance and compare/apply image optimizations. Use the `@immich/sdk` npm package for Immich API access and the image tools already provided by `Dockerfile.goreleaser`. Preserve the existing upload-proxy behavior and image target.

## Confirmed scope and workflow

- Search still images by date range and/or album; select individual assets.
- Accept JPEG, HEIC, and HEIF source images. Do not process videos or other image source formats in this version.
- Provide these built-in profiles:
  - JPEG → optimized JPEG using Caesium.
  - JPEG → AVIF using the existing lossy AVIF profile settings.
  - JPEG → lossy JXL using the existing lossy JXL profile settings.
  - JPEG → lossless JXL using the existing lossless JXL profile settings.
  - HEIC/HEIF → AVIF or JXL using ImageMagick.
- If multiple profiles are selected, optimize every selected image up front (three concurrently) and then let the user choose one candidate or skip each image independently, with the smallest eligible candidate highlighted.
- If one profile is selected, process the selected assets as a batch, present a result table, and require an explicit batch apply action.
- Only upload a candidate whose byte size is strictly less than the original.
- A batch-level delete-original option defaults off. When enabled, delete an original only after the replacement upload, tag/album assignment, and verification all succeed.
- Upload the replacement first, copy the original asset's tags and album membership, verify the new asset, then (optionally) delete the original. Any uncertain or failed step retains the original.

### Monthly cleanup tab (second tab)

- Year grid of 12 month boxes with per-month capture counts, taken from one `calendar-heatmap?type=Taken` request (requires the `user.read` scope); prev/next year navigation. Each box also carries a storage estimate for that month and is tinted against the heaviest month of the year, from `GET /api/library/months/{year}/storage`.
- The storage estimate is sampled, because Immich aggregates no sizes: every populated month is read with the first page of its assets (`withExif`) and scaled by the month's capture count, a month that fits in its first page is exact, and the grid marks scaled numbers with `~`. Months are sampled four at a time and the year is cached for ten minutes.
- Opening a month loads every asset captured in it (images and videos), oldest first, thumbnails only, capped at 3000 assets with a visible truncation notice. Archived assets are excluded unless the *Include archived assets* switch is on; the archived ones shown that way are badged and never offered an archive action. The query range is widened by a day on each side because `takenAt` is UTC while the month is derived from the asset's local capture time, then filtered exactly.
- An optional *Focused review* mode fills the viewport with one chronological stack at a time. Still images captured in the same local minute sit side by side (mobile uses a large snap carousel); videos remain as one-item stacks. Clicking the left/right half marks keep/trash, kept items may receive configured `EXTRA_BUTTONS` tags without being archived, recognized people link below each photo (or below a grid for the selected cell), and nothing is applied until *Apply & next*. *Skip for now* leaves the stack untouched, and a day overview shows remaining, queued, and reviewed stacks. Drafts and completed decisions are saved per month in the browser; a missing in-flight job is treated as uncertain and is never retried automatically.
- The optional *Singles grid* setting collects runs of single photos between burst stacks into grid pages (2×2, 3×3, 4×4, or 5×5, remembered in the browser); videos and bursts stay stacks, and a grid page never spans midnight.
- The focused mode uses `@tanstack/react-hotkeys` with an exclusive scope: `J`/`K` move between photos in the current stack or grid, `1`–`9` keep the focused photo and toggle the matching configured tag, `Space` keeps, `D`/`Delete`/`Backspace` stages trash, `Z` undoes, `Enter` applies and advances, `S` skips, `Alt+S` jumps to the next burst stack and skips singles, `O` opens the day overview, `?` opens the keyboard help, and `Escape` returns to the month grid.
- The month is rendered as a virtualized stream: the timeline is cut into rows (a burst card, or up to N single images) and only the rows around the viewport are mounted, with each row's real height measured after its first paint. The track count is read from the grid's own width and drives both the CSS grid and the row layout, so a row always fits the tracks it is rendered in; widths stop at four columns on desktop so a thumbnail stays readable as a photo.
- Assets sharing a capture minute (EXIF `localDateTime` truncated to the minute) form a burst group; the largest file in a group is highlighted as the suggested keep. Left click marks keep, right click marks trash, clicking the same mark clears it.
- Each burst group has its own action bar: trash the trash-marked images, compress the keep-marked images (smaller candidate enforced, original deleted only after verification), or archive the keep-marked images. Buttons are disabled when their set is empty, and each action confirms first.
- Ungrouped assets each get three per-asset buttons: compress and delete original, trash, archive. The trash button carries the destructive color, since it is the one action on the tile that cannot be undone from this app.
- A compression-profile selector in the month toolbar chooses the profile used by every compress action in that tab.
- Trash uses `DELETE /assets` with `force: false` (reversible Immich trash), archive uses `PUT /assets` with `visibility: "archive"`.
- The month is rendered as one stream ordered oldest first: assets sharing a capture minute collapse into a burst block, and consecutive singles collapse into ordinary grids, so the month reads from the 1st onwards.
- Library actions are enqueued as jobs and executed one at a time by an in-memory FIFO queue; a compression job waits for the single optimizer slot instead of failing when the Compress tab holds it. Assets with a pending job cannot be queued again, and a still-queued job can be cancelled.
- Compressed replacements are tagged `optimized` (upserted by name via `PUT /tags`, then verified together with the copied tags before any original is deleted). The month listing marks assets that already carry the tag by querying `SearchFilter.tagIds` over the same capture range.
- Every confirmation offers a "don't ask again" checkbox stored per action kind in local storage, with a *Re-enable prompts* control in the month toolbar.
- A prepared run that produced nothing eligible finishes itself instead of holding the single active-run slot, and any prepared run can be discarded (`POST /api/batches/:id/abandon`); the monthly compression flow abandons its own run when it cannot complete.

### Live photo tab (third tab)

- Lists still images that still reference a motion video, discovered with `SearchFilter.isMotion` and kept only when `livePhotoVideoId` is present, so the video to unlink is always known. Paged with a load-more cursor.
- "Unlink and trash" detaches the video with `PUT /assets/{id}` and `livePhotoVideoId: null`, then trashes the video alone with a non-forced delete. The video is only trashed after Immich reports the link is gone, so a still cannot end up pointing at a trashed video; the still's own file, date, albums and tags are untouched.
- Runs through the same job queue as the other library actions, so it is non-blocking and cancellable while queued.
- An opt-in *compress afterwards* flag re-compresses each unlinked still with the profile chosen automatically per format (`bestProfileFor`: AVIF for JPEG and HEIC/HEIF, because JXL would not render in a browser given the app bypasses the proxy's download conversion). Stills are grouped per profile and compressed with the existing batch pipeline, delete-original on, after the videos are gone so a replacement never inherits a dead motion link.

### Stats tab (fourth tab)

- A local record of what this service did to the library, kept in `stats.json` under `WEB_DATA_DIR` so it survives a restart. Immich only knows the current state of an asset, so "what was reclaimed" cannot be asked of it afterwards.
- Reclaimed space is counted where an original is actually removed, by the optimizer itself; a run that kept its originals counts as a replaced asset but reclaims no bytes. Job outcomes (trashed, archived, dropped motion videos, jobs run, failures) and configured-tag applications are recorded once per finished job by the queue.
- `GET /api/library/stats` serves the totals, a per-month breakdown, and the per-tag counts. The tab shows the headline numbers, a month-by-month table with a reclaimed-space bar, and the tags applied by cleanup buttons, including non-archiving Focused review tags.
- The file is versioned, written with a temp-file rename and coalesced writes, and a damaged file is set aside as `stats.json.corrupt` rather than overwritten, so a bad write cannot silently reset the history.

## Architecture and deployment

- Add a Hono/Node backend-for-frontend that uses `@immich/sdk` server-side. The browser calls only this service; the Immich API key is never returned to browser code.
- Build the UI as a React SPA bundled by Vite; React reconciliation keeps asset thumbnails attached to stable element keys, so polling never re-creates or re-requests them.
- Style the SPA with Tailwind CSS v4 and shadcn/ui; the app is a four-tab shell (Compress, Monthly cleanup, Live photos, Stats) with the shared Immich client in `web/client/src/api.ts`.
- Keep navigational and search state in the URL with `nuqs` and its plain-React adapter (no router is needed): the open tab, the monthly review's year/month/archived/focused-mode switch, and the compress form's filters. Navigation pushes history so Back walks the tabs, years, and months; filters replace it.
- Use `@tanstack/react-hotkeys` for app-wide shortcuts: `Alt+1`–`Alt+4` switch tabs, `F` opens Focused review, Compress and Live photos share `Mod+A`/`Esc`, Compress adds `Mod+Enter`, and Live photos adds `U`/`R`. `?` opens a shortcut reference dialog, while Focused review keeps its own larger `?` list. Shortcuts do not fire while typing in a field.
- Long lists virtualize rather than paginate: the month grid renders through `@tanstack/react-virtual` with the window as its scroll element, so a mounted month holds the rows around the viewport instead of thousands of tiles. The container's measured width decides the track count, which keeps the CSS grid and the row layout on the same number, and every row is measured after its first paint so estimated heights only fill the gap until then.
- Library writes go through one narrow surface: `POST/GET/DELETE /api/library/jobs` enqueues, lists and cancels jobs, and a server-side FIFO queue runs them one at a time. Compression jobs reuse the existing batch pipeline rather than adding a second write path.
- Pin `@immich/sdk` to `3.3.0-rc.0`, matching `immich-openapi-specs.json`; use its stable nested date/album/type filter and cursor pagination rather than deprecated flat search fields.
- The backend owns temporary downloads and candidate files and invokes only fixed, built-in optimizer profiles. Do not execute user-supplied commands or construct shell command strings from request data.
- Configure the Immich URL and API key using Docker environment variables or secret files. Require a separate web UI password because this service can mutate and delete assets. Document that it must be exposed only on a trusted network or through HTTPS.
- Extend the existing multi-stage Docker build with a web target sharing the current codec/tool runtime. Preserve the existing proxy target and its default behavior.
- Serve the minimal UI and API from the same web service/origin. Add deployment instructions and required environment variables.
- Publish the web image from CI on every push to `web-ui` as its own GHCR package (`<repo>-web`), tagged `latest` and the full commit hash, so it never collides with the GoReleaser-owned proxy package.

## Implementation steps

1. Create this plan and `WEB_OPTIMIZER_PROGRESS.json` with implementation states.
2. Add the Hono web service, server-side SDK client, configuration/secrets loading, authentication, and safe same-origin API routes.
3. Implement Immich album/date search, paginated asset selection, metadata retrieval, and thumbnail access needed by the UI.
4. Implement the fixed optimization profiles, bounded-concurrency processing, candidate size comparison, and temporary-file cleanup.
5. Implement the upload → copy tags/albums → verify → optional delete transaction. Fail closed: never delete the original on an upload, metadata, verification, or communication error.
6. Implement the minimal UI for search, image selection, profile selection, per-image comparison or single-profile batch review, progress, and explicit apply/skip actions.
7. Add the web Docker target and deployment documentation without building the image.
8. Run the web typecheck, focused-review unit tests, and production build locally; do not build a Docker image or make live Immich mutations for verification.
9. Add the monthly library endpoints: per-month capture counts, a full-month asset listing, and the job endpoints that enqueue, list and cancel library jobs, all validated per request.
10. Add the tab shell and convert every tab to Tailwind CSS v4 with shadcn/ui components.
11. Add the monthly cleanup flow: year grid, month view with same-minute burst groups, keep/trash marking, per-group and per-asset actions with confirmation, and the compression-profile selector.
12. Add the live photo tab: list stills with a linked motion video and unlink the video, trashing it alone through the job queue, with the optional compress-afterwards pass.
13. Order the month oldest first and interleave burst groups with single images.
14. Replace the single active-run slot with a non-blocking FIFO job queue that waits for the optimizer slot instead of failing.
15. Tag compressed replacements `optimized` and surface that in the month view.
16. Add the GitHub Actions workflow that builds and publishes the web image to GHCR.
17. Harden the destructive paths: validate motion links before acting on them, verify a replacement is readable back at the uploaded size before removing any original, and report an interrupted run as still applying instead of failed.
18. Hide queued assets from the month view immediately and restore the ones a job could not settle.
19. Add operator-defined tag-and-archive buttons through `EXTRA_BUTTONS`, validated on the server and applied through the job queue.
20. Open an asset in the user's own Immich from its thumbnail, through Immich's link helper.
21. Show the recognized, named people under each asset in the month view and link each face to that person's Immich page.
22. Let `WEB_AUTH_DISABLED=true` drop the built-in Basic auth for deployments that authenticate callers in front of the service, with a startup warning, an ignored password requirement, and the mode reported through `GET /api/config`.
23. Leave archived assets out of the monthly review by default, with an *Include archived assets* toggle that loads them badged and drops the archive actions that would do nothing.
24. Move the open tab, the monthly review's year/month/archived switch, and the compress form's filters into the URL with `nuqs`, so views are linkable and the Back button walks them.
25. Virtualize the month grid with `@tanstack/react-virtual` and drive its track count from the container's measured width, so a month of thousands of assets mounts only the rows around the viewport.
26. Enlarge the desktop thumbnails: stop the month grids at four columns instead of five.
27. Color the per-asset trash button in the month view with the destructive color, so the one irreversible action on a tile is visible at a glance.
28. Keep a local, versioned record of what this service did (`stats.json` in the data directory), counted where an original is really removed and once per finished job, and show it in a fourth *Stats* tab.
29. Estimate the storage size of every month in the year grid and color each month box by its share of the year's heaviest month.
30. Add opt-in, full-screen monthly focused review with local-minute photo stacks, responsive left/right decisions, tag-only keep actions, day progress, safe draft recovery, a per-stack review job, and scoped TanStack keyboard shortcuts.

## Safety invariants

- A candidate that is the same size or larger than its source cannot be uploaded.
- The original is retained by default and is never deleted before a replacement's existence, copied tags, and album membership are verified through Immich.
- Preserve and verify the linked video asset ID for Live Photos before any optional deletion of the source image.
- A motion link is never trusted blindly: the linked id must differ from the still and must be an untrashed video asset before the video is unlinked or trashed, so a broken link cannot remove the still.
- A replacement must be readable back from Immich with exactly the uploaded byte count before any original is removed; a failure at any earlier step retains the original.
- Failed or ambiguous replacement operations report their state and leave the original intact.
- Temporary source and candidate data is removed when no longer needed; persistent state, if required for recoverability, must not trigger automatic deletion after restart.
- API keys and passwords are not embedded in static assets, URLs, logs, or client-visible API responses.

## Acceptance criteria

- A user can connect to an existing Immich instance, search by date/album, select supported assets, and see originals and candidate sizes.
- All selected profiles use the established toolchain and their intended conversion settings.
- Multi-profile runs optimize every selected asset up front (three concurrently) and then accept independent per-asset decisions with the smallest candidate highlighted; a single profile supports batch processing and explicit batch application.
- Only smaller candidates are uploaded.
- Replacement tags and album memberships are copied and verified before any optional original deletion.
- The existing proxy image/target remains usable with its previous default behavior.
- The repository contains deployment instructions and a progress JSON that accurately reflects implementation and verification status.
- The monthly tab shows per-month capture counts for a year and loads a selected month as thumbnails only.
- Assets captured in the same minute are grouped, keep/trash marks drive the per-group actions, and ungrouped assets expose compress, trash, and archive per asset.
- Trash uses the non-forced delete so it stays restorable in Immich; standard cleanup actions are confirmed and focused review requires an explicit per-stack Apply action.
- The live-photo tab lists stills with a paired motion video and can drop the video alone, leaving the image, its metadata and its album memberships intact, and supports click, shift-click, drag-box, Cmd/Ctrl+A and Esc selection.
- Library actions are queued and run one after another, so a user can start many without waiting for any one to finish, and a queued job can be cancelled.
- A replacement carries the `optimized` tag and the month view marks assets that already have it.
- A push to `web-ui` publishes a pullable web image to GHCR tagged with the commit hash.
- Queuing an archive, trash, or compression removes its assets from the month immediately, and an asset the job could not settle returns to the grid.
- The monthly review and its month listing leave archived assets out unless *Include archived assets* is ticked, and archived assets shown that way are marked and never offered an archive action.
- Buttons defined in `EXTRA_BUTTONS` tag the selected assets with their label and archive them, a tag that no configured button declares is rejected, and the assets only leave the timeline after Immich confirms the tag was applied.
- Clicking a thumbnail opens that asset in the user's own Immich through the link helper.
- Each asset in the month view lists the people Immich recognized in it, and clicking a face opens that person's Immich page.
- `WEB_AUTH_DISABLED=true` serves the UI and API without the Basic-auth challenge and needs no password, reports the mode in `/api/config`, and logs a warning that the service is unauthenticated; any other value stops the container. The UI shows no authentication notice, since a deployment that authenticates callers in front of the service should look the same as any other.
- A month of thousands of assets scrolls without mounting a tile per asset: only the rows around the viewport are in the document, and a row is never laid out for a different number of tracks than it is rendered in.
- Desktop thumbnails in the monthly view are larger than before: the grid stops at four columns instead of five.
- The trash action under a single asset is red, so the destructive choice is recognizable without a tooltip.
- Every finished job and every removed original is counted in `stats.json` under the data directory, the record survives a container restart, a damaged file is kept aside instead of overwritten, and the *Stats* tab shows the totals, the month-by-month breakdown, and configured-tag application counts. A replacement that kept its original adds to the replaced count but not to the reclaimed bytes.
- Each month box in the year grid carries a storage estimate, scaled numbers are marked as estimates, and the boxes are tinted against the heaviest month of the year.
- Focused review is opt-in and leaves the regular month grid unchanged; stacks are chronological, photos in a local capture minute are shown together, and videos are never silently dropped.
- Clicking the left/right half stages Keep/Trash without mutating Immich; tags on keeps do not archive, and Apply & next enqueues only configured tags and reversible trash actions.
- The day overview reports remaining and queued stacks; local drafts survive reloads, and a job missing after restart is treated as unknown until the user explicitly verifies Immich.
- Keyboard shortcuts are scoped to Focused review and suspended in inputs and dialogs; the same decisions remain available through touch-friendly buttons.
