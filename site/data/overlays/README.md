Place one YAML file per verse in this directory. Hugo loads these files at build time under `.Site.Data.overlays`.

Each file follows the `VerseTranslationOverlay` contract:

- `verse_ref`, `language_code`, `translation_id`, `revision`
- `current_review_stage`, `review_history`
- `alignments`, each containing `id`, `target_text`, `target_macula_ids`, and `alignment_type`
- Optional alignment fields: `alternates`, `pronunciations`, `translator_notes`, and `metadata`

Use `MaculaBaseToken.DataAttribution` when publishing Macula identifiers. The underlying Macula Greek data is attributed under CC BY 4.0.
