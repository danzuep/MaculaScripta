# MaculaScripta

MaculaScripta is a .NET 10 foundation for Git-native translation overlays aligned to Macula Greek tokens.

## Projects

- `MaculaScripta.Contracts` contains dependency-free domain records.
- `MaculaScripta.Core` contains gloss resolution, lemma frequency ranking, and lemma audio binding.
- `Protos/macula_scripta.proto` defines the versioned gRPC service contract. The schema is kept as source and is not generated during the dependency-free Contracts build.
- `site/` is a Hugo site that renders YAML overlays and provides local offline edits with JSON patch export.

Build the C# projects with:

```sh
dotnet build MaculaScripta.slnx
```

## YAML overlays

Add language-specific files under `site/data/overlays/<language>/`. Each file contains an `attribution` string and a `verses` list of `VerseTranslationOverlay` records. Hugo loads these files at build time; use the snake_case field names from `Protos/macula_scripta.proto`. Alignment entries carry their associated `target_macula_ids`, while a target word may map to multiple IDs or none.

Keep only supported data files in that directory, not Markdown documentation: Hugo attempts to parse every file there as data.

Each item in `verses` follows the `VerseTranslationOverlay` contract:

- `verse_ref`, `language_code`, `translation_id`, `revision`
- `current_review_stage`, `review_history`
- `alignments`, each containing `id`, `target_text`, `target_macula_ids`, and `alignment_type`
- Optional alignment fields: `alternates`, `pronunciations`, `translator_notes`, and `metadata`

For raw manuscript retrieval, configure `params.rawManuscriptBaseURL` in `site/hugo.toml` and set `raw_manuscript_path` on an overlay to a path relative to that base URL. The browser emits the fetched text as a `manuscriptloaded` event; parsing and alignment remain the responsibility of the C# engine.

Include Macula dataset attribution with published identifiers: Macula Greek dataset (SBLGNT base), CC BY 4.0.

The seed data in `site/data/overlays/en/JHN_1.yaml` and
`site/data/overlays/yue/JHN_1.yaml` covers John 1:1–5. Jyutping entries are
rendered as Ruby text above Cantonese translation blocks.

Use `MaculaBaseToken.DataAttribution` when publishing Macula identifiers.

Offline text changes are stored in IndexedDB and can be exported as a JSON patch. The site does not store GitHub credentials or push changes directly.

The service worker fetches the latest published pages and assets when online and
falls back to cached copies when offline. If an older installation still shows
the empty page, reload once to activate the updated worker, then reload again to
load the current translations. Offline edits remain in IndexedDB.
