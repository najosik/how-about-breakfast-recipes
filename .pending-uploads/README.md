Staging folder for backfill photos when there's no PC around to run
`upload_to_r2.py` directly.

Drop a file here (e.g. `9996.jpg`) and push to `main` — the "Upload pending
images" GitHub Actions workflow uploads it to R2 under `images/<filename>`
and then removes it from this folder automatically. Don't leave files here
on purpose; it's a pass-through, not storage.
