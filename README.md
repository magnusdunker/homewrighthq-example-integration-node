# Eksempel-tæller (Node) til HomewrightHQ

En lille ekstern integration til [HomewrightHQ](https://github.com/magnusdunker/homewrighthq), skrevet i JavaScript. Den gør det samme som [Rust-eksemplet](https://github.com/magnusdunker/thehome-example-integration) og er til at afprøve integrationer fra GitHub, eller som udgangspunkt for at skrive sin egen i Node.

Hver opsætning giver en enhed med:

- en sensor, **Antal**, der tæller én op med et fast interval
- en kontakt, **Tæller**, der sætter tællingen på pause
- en knap, **Nulstil**, der sætter tallet til 0 og sender hændelsen `example_counter_node_reset`

Desuden har den tjenesten `example_counter_node.set`, der sætter en tæller til en bestemt værdi, og et options-forløb, hvor intervallet kan ændres. Tallet gemmes i integrationens datamappe, så det overlever en genstart.

## Installation

I HomewrightHQ: **Indstillinger → Integrationer → Fra GitHub**. Indsæt

```
https://github.com/magnusdunker/homewrighthq-example-integration-node
```

og tryk **Installér**. Tilføj derefter **Eksempel-tæller (Node)** under **Tilføj integration**.

Brugeren skal ikke have Node installeret. Releasen indeholder færdige programmer, hvor Node-runtimen er bygget ind.

## Sådan virker det

En ekstern integration er et selvstændigt program. HomewrightHQ starter det og taler med det over JSON-RPC på stdin og stdout. Protokollen er beskrevet i HomewrightHQ's [docs/custom-integrations.md](https://github.com/magnusdunker/homewrighthq/blob/main/docs/custom-integrations.md).

Repoet indeholder:

- `thehome.json`: domæne, navn og protokolversion
- `sdk/thehome-plugin.js`: protokollen i ét modul uden afhængigheder
- `src/counter.js`: selve integrationen
- `src/main.js`: programmets indgang
- `test/`: tests, der kører programmet og spiller HomewrightHQ
- `.github/workflows/release.yml`: bygger programmerne og lægger dem på en release

HomewrightHQ kræver i dag ét program pr. platform. Workflowet bruger `bun build --compile` til at pakke koden og en JavaScript-runtime sammen i én fil til Windows, Linux (x64 og arm64) og macOS. Hver fil fylder 70-95 MB, fordi runtimen er med. Koden bruger kun Nodes standardmoduler, så den kører både med Node og Bun.

## Lav din egen

1. Kopiér repoet og ret `domain` og `name` i `thehome.json`. Domænet må kun indeholde små bogstaver, tal og `_` og må ikke være en indbygget integrations domæne.
2. Ret `DOMAIN` øverst i `release.yml`.
3. Skriv integrationen som et objekt med `setupEntry` og de andre metoder, du har brug for, og kald `run()` fra `sdk/thehome-plugin.js`. Typerne står som JSDoc i SDK'en.
4. Afhængigheder fra npm er fine. `bun build --compile` bundler dem ind i programmet.
5. Push et tag, f.eks. `git tag v0.1.0 && git push --tags`. Workflowet bygger og opretter releasen.

HomewrightHQ henter altid den nyeste release. Programmerne skal hedde `<domæne>-<target>`, f.eks. `example_counter_node-aarch64-unknown-linux-gnu`.

```sh
npm test          # kører testene med Node
npm start         # starter programmet; det venter på beskeder fra HomewrightHQ på stdin
npx bun build --compile src/main.js --outfile dist/example_counter_node
```

## Licens

MIT
