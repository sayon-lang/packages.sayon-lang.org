# The registry protocol

A registry keeps published Sayon packages: each version's archive, and an index of what every version is and depends on. `sayon install` reads the index and fetches archives, `sayon search` asks the API, and `sayon publish`, `login`, and `logout` use the API with an account. [The language reference](https://github.com/sayon-lang/docs.sayon-lang.org/blob/main/language.md#versions-from-the-registry) shows how projects use it; this page is how the two sides talk. The client is in [sayon-lang/sayon](https://github.com/sayon-lang/sayon) (`crates/driver/src/registry.rs` and `crates/cli/src/registry.rs`), the server is this repository, and Sayon's index is [packages.sayon-lang.org-index](https://github.com/sayon-lang/packages.sayon-lang.org-index).

Protocol 1 is HTTPS, or HTTP to `localhost` for a registry on the same computer. A registry is named by its index's address, which `SAYON_REGISTRY` and `--registry` give; this server serves its index at `<registry>/index`.

## The index

Its files are plain text, read with `GET`; Sayon reads only those it needs.

- `config.json`: `{"protocol": 1, "api": "<address of the API>", "download": "<address of an archive, with {name} and {version}>"}`.
- A file for each package, placed by its name as crates.io-index places them: `1/a`, `2/ab`, `3/a/abc`, and `ab/cd/abcdef` for longer names. A package with no file has no versions (404).
- In it, a line of JSON for each version, oldest first; lines are only ever added:

```json
{"name":"words","version":"1.0.0","digest":"sha256:<64 hex digits>","description":"Words, louder","dependencies":[{"alias":"strings","package":"strings","requirement":"0.2","registry":null}],"published":"2026-10-28T09:30:00Z"}
```

A dependency's `registry` is `null` when it comes from the same registry. The latest version is the greatest release, or before the first release the greatest pre-release.

## The API

Under `<api>/api/v1`; answers are JSON, but archives. A request the registry refuses gets a status of 400 or more and `{"error": "<why, in a sentence>"}`, which Sayon shows as it is.

| Request | Answer |
| --- | --- |
| `GET /api/v1` | `{"protocol": 1}` |
| `GET /api/v1/packages/<name>/<version>/archive` | the version's archive, with its digest in `X-Sayon-Digest`, or 404 |
| `GET /api/v1/search?q=<words>&limit=<1 to 50, 20 by default>` | `{"packages": [{"name", "latest", "description"}]}`: the packages with the words in their names or descriptions, an exact name first |
| `PUT /api/v1/packages/<name>/<version>` with the archive, and `Authorization: Bearer <token>` | 201 and `{"name", "version", "digest"}` |
| `GET /api/v1/me` with a token | `{"name": "<account>"}`, or 401 |
| `POST /api/v1/users` with the operator's token and `{"name": "<account>"}`, and `"replace": true` for a new token | 201 (200 when replaced) and `{"name", "token"}` |

## Archives

An archive is the package's files in one sequence of bytes: `sayon-package-digest-1` and a NUL byte, then for each file, in the order of its path (with `/`, compared byte by byte), the length of its path, the path, the length of its contents, and the contents, each length 8 bytes, least significant first. The archive's SHA-256, written `sha256:<hex>`, is the version's digest in the index, and the same digest `sayon.lock` records for the files it unpacks to.

A package holds every file of its folder but those with a part starting with `.`, and `build`, `target`, and `sayon.lock` at its top. Its archive is 10 MiB at most, with 10,000 files at most. Both sides refuse an archive with a path that is absolute, has `..`, `\`, `:`, or a hidden part, comes out of order or twice, or differs from another only in case.

## Publishing

A publication's archive must have a `sayon.toml` naming the same package and version as the address, with a version of semantic versioning (`1.2.3`, `1.2.3-beta.1`), and every dependency from a registry. The registry refuses:

- 401 without a token it knows;
- 403 when the name belongs to another account: the account that published a name first owns it;
- 409 when the version is published already, since a version never changes;
- 413 for an archive over 10 MiB;
- 400 for an archive it cannot read, and for the rest.

It keeps the archive first, then adds the version's line to the index, so that the index never lists a version without one. Names are lowercase letters, digits, and `_`, starting with a letter, 64 characters at most, for packages and accounts alike.

## Accounts

The registry's operator makes accounts: with `--account` when the registry starts, or `POST /api/v1/users` with the operator's token. Each account has one token, 32 random bytes from the system's secure source, shown once; the registry keeps only its SHA-256. `"replace": true` gives an account a new token, and the old one stops working. `sayon login` checks a token with `GET /api/v1/me` before keeping it.
