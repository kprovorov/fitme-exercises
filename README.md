# fitme-exercises

The Fitme Library's content repo: Exercises and Covers, their media (Git LFS), the loaders that validate them and `pnpm bundle`, which publishes it as `library.json`. The Exercise Library API that serves it is `apps/library` in the Fitme monorepo. See [AGENTS.md](AGENTS.md) for the layout, the bundle contract, how to add an Exercise or a Cover, the Exercise slug and Cover id rules, and how licensed Cover photos are handled.

Exercises keep a 720p `video.mp4`, a 1024×1024 thumbnail and an optional high
resolution `original.mp4` in Git LFS. Originals stay in this repo; only the playback
video and thumbnail are published to storage.

Covers keep only the served copy of each photo in Git LFS; the licensed masters stay in
the owner's own storage (see Licensed photos in AGENTS.md).
