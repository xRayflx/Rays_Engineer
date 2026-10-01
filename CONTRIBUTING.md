# Contributing

Thanks for wanting to contribute to Rays Engineer! This is how it works:

1. **Issue first:** open an issue (or find an existing one) before writing code.
2. **Fork** this repository.
3. **Create a branch** in your fork. Recommended naming:
   `fix/<issue-nr>-<short-description>` or `feat/<issue-nr>-<short-description>`,
   e.g. `fix/42-lap-export`.
4. **Open a pull request** against `main` and write `Closes #<issue-nr>` in the description.
5. **Accept the CLA:** read the [CLA](CLA.md) and tick the box "I agree to the CLA" in the
   pull request. This grants the maintainer unrestricted rights to use your contribution;
   you keep your copyright.
6. The automatic checks (tests, issue reference, CLA) must be green.
7. The maintainer reviews and merges. The issue is closed automatically on merge.

Pull requests without a reference to an open issue or without CLA agreement fail automatically.
Checks on pull requests from first-time contributors only start after the maintainer approves them.

## Development

Setup, commands and architecture: see the [README](README.md) and
[`Rays_Engineer.Desktop/README.md`](Rays_Engineer.Desktop/README.md). Before opening a PR, run:

```bash
cd Rays_Engineer.Desktop
npm run lint
npm test
npm run build
```

Ground rules for changes:

- The app stays **offline** — no network requests, no accounts.
- Don't weaken the security setup (context isolation, sandbox, CSP, IPC sender checks).
- Only document LMU file formats in `docs/SCHEMA.md` that are verified against real files.
- The UI is English-only.

## License

The project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE):
using and improving it is allowed, commercial use is not.
