# Example counter (Node) for HomewrightHQ

A small external integration for [HomewrightHQ](https://github.com/magnusdunker/homewrighthq), written in JavaScript. It does the same as the [Rust example](https://github.com/magnusdunker/thehome-example-integration) and is for trying out integrations from GitHub, or as a starting point for writing your own in Node.

Each setup creates a device with:

- a sensor, **Antal** (count), that counts up by one at a fixed interval
- a switch, **Tæller** (counter), that pauses the counting
- a button, **Nulstil** (reset), that sets the number to 0 and fires the event `example_counter_node_reset`

It also has the service `example_counter_node.set`, which sets a counter to a given value, and an options flow where you can change the interval. The number is stored in the integration's data folder, so it survives a restart.

## Installation

In HomewrightHQ: **Settings → Integrations → From GitHub**. Paste

```
https://github.com/magnusdunker/homewrighthq-example-integration-node
```

and press **Install**. Then add **Eksempel-tæller (Node)** under **Add integration**.

The user does not need Node installed. The release contains ready-made programs with the Node runtime built in.

## How it works

An external integration is a standalone program. HomewrightHQ starts it and talks to it over JSON-RPC on stdin and stdout. The protocol is described in HomewrightHQ's [docs/custom-integrations.md](https://github.com/magnusdunker/homewrighthq/blob/main/docs/custom-integrations.md).

The repo contains:

- `thehome.json`: domain, name and protocol version
- `sdk/thehome-plugin.js`: the protocol in one module with no dependencies
- `src/counter.js`: the integration itself
- `src/main.js`: the program's entry point
- `test/`: tests that run the program and play the part of HomewrightHQ
- `.github/workflows/release.yml`: builds the programs and puts them on a release

HomewrightHQ currently requires one program per platform. The workflow uses `bun build --compile` to pack the code and a JavaScript runtime into one file for Windows, Linux (x64 and arm64) and macOS. Each file is 70-95 MB, because the runtime is included. The code uses only Node's standard modules, so it runs with both Node and Bun.

## Make your own

1. Copy the repo and change `domain` and `name` in `thehome.json`. The domain may only contain lowercase letters, digits and `_`, and must not be the domain of a built-in integration.
2. Change `DOMAIN` at the top of `release.yml`.
3. Write the integration as an object with `setupEntry` and the other methods you need, and call `run()` from `sdk/thehome-plugin.js`. The types are documented as JSDoc in the SDK.
4. Dependencies from npm are fine. `bun build --compile` bundles them into the program.
5. Push a tag, e.g. `git tag v0.1.0 && git push --tags`. The workflow builds and creates the release.

HomewrightHQ always fetches the newest release. The programs must be named `<domain>-<target>`, e.g. `example_counter_node-aarch64-unknown-linux-gnu`.

```sh
npm test          # runs the tests with Node
npm start         # starts the program; it waits for messages from HomewrightHQ on stdin
npx bun build --compile src/main.js --outfile dist/example_counter_node
```

## License

MIT
