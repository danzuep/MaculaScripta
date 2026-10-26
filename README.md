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

## John 1:1 linguistic transformation

Open `john-1-1/` from the homepage to cycle through Greek with IPA, English
word order (including the inserted `[the]`), and Cantonese with Jyutping.
Playback advances every seven seconds; pausing preserves the remaining time.
Reduced-motion users start paused, and all stages remain readable without JavaScript.

Maintain the demonstration text, annotations, stage labels, and playback duration
in `site/data/john_1_1.yaml`. This illustrative data is separate from the editable
translation overlays. Units are listed in reading order; `source_order` on the
English final clause specifies the Greek order used as the animation's starting
positions. Presentation lives in `site/layouts/transformation.html` and
`site/static/transformation.css`; playback lives in `site/static/transformation.js`.
The Hugo page metadata lives in `site/content/john-1-1.md`.

Build locally with Hugo 0.160.1 (the version used by the Pages workflow):

```sh
hugo --source ./site --minify
```

Offline text changes are stored in IndexedDB and can be exported as a JSON patch. The site does not store GitHub credentials or push changes directly.

The alignment page shows Greek beneath each translation using
`site/data/greek_tokens.yaml`, keyed by Macula ID. Add source tokens there when
adding overlays for new verses. Dataset attribution appears once in the footer.

Expand **Settings** to choose light or dark appearance or disable shared-ID edits.
Shared-ID editing is enabled by default: an edit replaces the text of every card
sharing any of the edited card's Macula IDs, including cards in other languages
and cards covering larger phrases. It does not follow indirect ID overlaps.
Disable it to edit just one card. Settings are remembered in this browser.
The latest successfully saved batch is shaded until another edit or a reload;
all saved edits are restored on reload and included in the JSON export.

The service worker fetches the latest published pages and assets when online and
falls back to cached copies when offline. If an older installation still shows
the empty page, reload once to activate the updated worker, then reload again to
load the current translations. Offline edits remain in IndexedDB.
