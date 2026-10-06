# Preparing a GitHub release

The repository is designed to contain source code and generic examples only. Your working `.env.local`, media, `data/`, `.cache/`, `.artifacts/`, virtual environment, model files, and generated systemd unit are ignored. Do not put custom data directories under source directories or force-add private files.

1. Choose a project license and add `LICENSE` before publishing if you want to grant reuse rights. The release script does not choose a license on your behalf.
2. Run `npm test`, `npm run build`, `npm run typecheck`, and `npm run release:check`.
3. Run `npm run release:bundle` to produce `.artifacts/procreator-VERSION.tar.gz`. This uses an explicit source inventory, so ignored private files and machine-specific generated units are excluded regardless of Git state. It requires the standard `tar` command.
4. Extract that source bundle into a clean directory and review its contents. Create a GitHub repository and push from that clean directory, or use the GitHub interface to upload the reviewed files.
5. For a working checkout already under Git, inspect `git status --short`, `git diff --cached`, and `git ls-files` before pushing. Ignore rules do not remove files previously committed to Git. The pattern scan is a useful check, not a guarantee that arbitrary added content is safe to publish.

The public repository must not contain personal artwork screenshots unless you intentionally choose to publish them. No artwork or pretrained model weights are bundled. Review the licenses of any third-party assets or model weights you separately distribute.

GitHub Actions runs the fixture-based tests, build, type check, and release scan without a media collection or RAM++ model. The npm package is marked `private` to prevent accidental npm publication; this does not restrict GitHub publication.
