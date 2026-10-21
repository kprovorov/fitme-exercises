# fitme-exercises

The Fitme Exercise Library's content repo: content, media (Git LFS), the loader that validates it and `pnpm bundle`, which publishes it as `library.json`. The Exercise Library API that serves it is `apps/exercises` in the Fitme monorepo. See [AGENTS.md](AGENTS.md) for the layout, the bundle contract, how to add an Exercise and the Exercise slug rules.

Exercises keep a 720p `video.mp4`, a 1024×1024 thumbnail and an optional high
resolution `original.mp4` in Git LFS. Originals stay in this repo; only the playback
video and thumbnail are published to storage.
