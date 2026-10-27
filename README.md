<p align="center">
  <img src="logo.svg" alt="Sayon logo" width="120">
</p>

<h1 align="center">Sayon's package registry</h1>

The service behind `sayon install`, `search`, `info`, `publish`, `login`, and `logout`: published [Sayon](https://github.com/sayon-lang/sayon) packages, each version's archive, and the accounts that publish them. [PROTOCOL.md](PROTOCOL.md) is how `sayon` talks to it.

Sayon's registry is not operated yet; it will be at `packages.sayon-lang.org`. Until then `sayon` uses the registry on your own computer, at `http://127.0.0.1:4100`, which this repository runs.

## On this computer

With [Node](https://nodejs.org) 22.5 or later, and nothing to install:

```bash
node local.mjs --port 4100 --data data --account ada
```

It serves the registry at `http://127.0.0.1:4100`, keeps its data in the folder `data`, and prints one line of JSON with the address and a token for each `--account`. `sayon` finds it there by default:

```bash
sayon login
sayon publish
```

`sayon login` asks for the token. Set `SAYON_REGISTRY_ADMIN_TOKEN` before starting it to make accounts later, with `node admin.mjs http://127.0.0.1:4100 <name>`. `--port 0` takes a free port, as the tests of `sayon` do; `SAYON_REGISTRY` then tells `sayon` where it is.

## How it is made

`worker.js` is the whole service, a [Cloudflare Worker](https://developers.cloudflare.com/workers/): accounts, packages, and versions in a D1 database (`schema.sql`), and archives in KV, written before their rows so that no listed version lacks one. The two rows of a publication go in one batch whose inserts check the owner, so two publications at once cannot take a name or a version from each other. It checks an archive as `sayon` does and reads its `sayon.toml`.

`local.mjs` runs the same module in Node, with `node:sqlite` in place of D1 and a folder in place of KV. `admin.mjs` makes accounts on any registry that has the admin token.

## Tests

```bash
node --test
```

`test/registry.test.mjs` starts the registry and goes through what the protocol promises: accounts and tokens, publishing and its refusals, information, search, and archives with their digests. The tests of [sayon-lang/sayon](https://github.com/sayon-lang/sayon) also run `sayon` itself against this registry, when this repository is checked out beside it, as `../packages.sayon-lang.org`.

## On Cloudflare

The service is built for Cloudflare's free plan, which runs it at `https://<name>.<subdomain>.workers.dev` with no domain of your own. With an account at Cloudflare:

```bash
npx wrangler@4 login
npx wrangler@4 d1 create sayon-registry
npx wrangler@4 kv namespace create ARCHIVES
```

Put the two ids they print in `wrangler.toml`, then create the tables, deploy, and give the registry its admin token, a long random one that you keep:

```bash
npx wrangler@4 d1 execute sayon-registry --remote --file schema.sql
npx wrangler@4 deploy
npx wrangler@4 secret put ADMIN_TOKEN
```

`deploy` prints the registry's address. `npx wrangler@4 dev --local` runs it in Cloudflare's own runtime on this computer, with D1's own engine.

## License

[Apache License, Version 2.0, with LLVM's exception](LICENSE), as Sayon.
