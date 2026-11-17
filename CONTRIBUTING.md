# Contributing

Issues and pull requests are welcome.

- **Found a wrong row on the live site?** Use "Report a wrong row" on the page. It reaches us faster than an issue.
- **Found a bug or have an idea?** Open an issue. Say what you did, what you expected and what happened.
- **Have a fix?** Open a pull request. Keep it small and about one thing. Run the checks first:

  ```bash
  TODAY=2026-11-06 npm run check
  ```

  Checks that need the private checked data print `SKIP`. That is fine.

## How changes reach the live site

The live site is built from a private repository that also holds the checked data. This public repository is a
copy of its code, refreshed from time to time.

When we merge your pull request here, we copy the change into the private repository by hand. It then shows up on
the live site, and comes back here with the next refresh. So a merged change can take a while to appear, and the
next refresh may look slightly different from what you sent if we had to fit it around private code.

## Licence

By sending a change, you agree that it is published under this repository's licences: AGPL-3.0 for the app, MIT
for `client/`.

Security problems: please do not open a public issue. See [SECURITY.md](SECURITY.md).
