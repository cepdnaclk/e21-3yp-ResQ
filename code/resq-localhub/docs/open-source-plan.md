# Open Source Plan (Future)

## Goal

The repository is structured so it can be opened to contributors later with minimal restructuring.

## No-Secrets Policy

- Never commit credentials, private keys, or production secrets.
- Keep all sensitive values out of source control.
- Use `.env.example` only for placeholders.

## Recommended Future Repository Files

- `LICENSE`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`

## Recommended License Direction

Use **Apache-2.0** as the default direction for future open-source release.

## Contributor Runtime Expectations

- Core runtime should stay simple and local-first.
- Docker can be offered as an optional convenience for contributors.
- Docker should not become a required runtime for the Local Hub application.
