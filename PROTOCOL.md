# The registry protocol

A registry keeps published Sayon packages: each version's archive and what it depends on. `sayon install` fetches versions from it, `sayon search` and `sayon info` read it, and `sayon publish` adds to it. [The language reference](https://github.com/sayon-lang/docs.sayon-lang.org/blob/main/language.md#versions-from-the-registry) shows how projects use it; this page is how the two sides talk. The client is in [sayon-lang/sayon](https://github.com/sayon-lang/sayon) (`crates/driver/src/registry.rs` and `crates/cli/src/registry.rs`), and this repository is the service.

Protocol 1 is HTTPS (or HTTP to `localhost`, for a registry on the same computer), with every address under `<registry>/api/v1`. Answers are JSON, but archives. A request the registry refuses gets a status of 400 or more and `{"error": "<why, in a sentence>"}`, which Sayon shows as it is.

| Request | Answer |
| --- | --- |
| `GET /api/v1` | `{"protocol": 1}` |
| `GET /api/v1/packages/<name>` | the package (below), or 404 |
| `GET /api/v1/packages/<name>/<version>/archive` | the version's archive, with its digest in `X-Sayon-Digest`, or 404 |
| `GET /api/v1/search?q=<words>&limit=<1 to 50, 20 by default>` | `{"packages": [{"name", "description", "latest"}]}`: the packages with the words in their names or descriptions, an exact name first |
| `PUT /api/v1/packages/<name>/<version>` with the archive, and `Authorization: Bearer <token>` | 201 and `{"name", "version", "digest"}` |
| `GET /api/v1/me` with a token | `{"name": "<account>"}`, or 401 |
| `POST /api/v1/users` with the admin token and `{"name": "<account>"}`, and `"replace": true` for a new token | 201 (200 when replaced) and `{"name", "token"}` |

A package is:

```json
{
  "name": "words",
  "owner": "ada",
  "description": "Words, louder",
  "latest": "1.0.0",
  "versions": [
    {
      "version": "1.0.0",
      "digest": "sha256:<64 hex digits>",
      "size": 412,
      "published": "2026-10-27T09:30:00.000Z",
      "publisher": "ada",
      "dependencies": [
        { "alias": "strings", "package": "strings", "requirement": "0.2" }
      ]
    }
  ]
}
```

Versions come oldest first. `latest` is the greatest release, or before the first release the greatest pre-release. A dependency has `registry` only when its package's manifest names one; without it, the dependency comes from the same registry.

## Archives

An archive is the package's files in one sequence of bytes: `sayon-package-digest-1` and a NUL byte, then for each file, in the order of its path (with `/`, compared byte by byte), the length of its path, the path, the length of its contents, and the contents, each length 8 bytes, least significant first. The archive's SHA-256, written `sha256:<hex>`, is the version's digest, and the same digest `sayon.lock` records for the files it unpacks to.

A package holds every file of its folder but those with a part starting with `.`, and `build`, `target`, and `sayon.lock` at its top. Its archive is 10 MiB at most, with 10,000 files at most. Both sides refuse an archive with a path that is absolute, has `..`, `\`, `:`, or a hidden part, comes out of order or twice, or differs from another only in case.

## Publishing

A publication's archive must have a `sayon.toml` naming the same package and version as the address, with a version of semantic versioning (`1.2.3`, `1.2.3-beta.1`), and every dependency from a registry. The registry refuses:

- 401 without a token it knows;
- 403 when the name belongs to another account: the account that published a name first owns it;
- 409 when the version is published already, since a version never changes;
- 413 for an archive over 10 MiB;
- 400 for an archive it cannot read, and for the rest.

Names are lowercase letters, digits, and `_`, starting with a letter, 64 characters at most, for packages and accounts alike.

## Accounts

The registry's operator makes accounts: `POST /api/v1/users` with the admin token, or `admin.mjs`. Each account has one token, made by the registry from 32 random bytes and shown once; the registry keeps only its SHA-256. `"replace": true` gives an account a new token, and the old one stops working. `sayon login` checks a token with `GET /api/v1/me` before keeping it.
