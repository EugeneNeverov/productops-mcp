# Releasing

A release publishes three npm packages (`@productops-mcp/core`, `@productops-mcp/prioritization`, `@productops-mcp/jira`), registers both servers in the [official MCP Registry](https://registry.modelcontextprotocol.io), and creates a GitHub Release with the changelog and the Claude Desktop extensions (`.mcpb`). All of it runs in [`.github/workflows/release.yml`](../.github/workflows/release.yml) when a `vX.Y.Z` tag is pushed.

## Every release

1. Bump `version` in the three `packages/*/package.json` files and in both `packages/*/server.json` files (top level and `packages[0].version`). `node scripts/check-release.mjs vX.Y.Z` must pass.
2. Add a `## [X.Y.Z] - YYYY-MM-DD` section to [CHANGELOG.md](../CHANGELOG.md); it becomes the release notes.
3. Merge to `main`, then tag the merge commit and push the tag:
   ```sh
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
4. Watch the **Release** workflow. Each step skips work that is already done (a version already on npm, a release that exists), so a failed run can be re-run.

To try the pipeline without publishing, run the workflow by hand (**Actions → Release → Run workflow**) with `dry_run` checked: it builds, tests, packs the tarballs and the `.mcpb` files, and uploads them as a workflow artifact.

## One-time setup

### npm

- npm organization `productops-mcp` (done 2026-11-18).
- **First publish.** npm trusted publishing can only be configured for a package that already exists, so the first release uses a token. Create a granular access token on npmjs.com (**Access Tokens → Generate New Token → Granular**), with read and write access to the `productops-mcp` organization's packages and "bypass 2FA" enabled, valid for 7 days. Save it in the repository as the secret `NPM_TOKEN` (**Settings → Secrets and variables → Actions**).
- **After the first publish**, for each of the three packages on npmjs.com: **Settings → Trusted Publisher → GitHub Actions**, owner `EugeneNeverov`, repository `productops-mcp`, workflow `release.yml`, environment `release`. Then, under **Publishing access**, choose "Require two-factor authentication and disallow tokens", delete the `NPM_TOKEN` secret and revoke the token. Later releases authenticate with OIDC, with no long-lived secret.

### MCP Registry

Nothing to set up. The workflow signs in with GitHub OIDC, which grants the `io.github.EugeneNeverov/*` namespace, and the registry checks that the npm package's `mcpName` matches `server.json`.

### GitHub

The workflow creates the `release` environment on its first run. Optionally add a required reviewer to it (**Settings → Environments → release**) so every publish waits for an approval.

## Directories that pick up the release

See [listings.md](listings.md) for Smithery, Glama, mcp.so and others.
