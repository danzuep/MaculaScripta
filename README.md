# MaculaScripta

MaculaScripta is a Hugo Greek New Testament reader with a .NET 10 foundation for Git-native translation overlays aligned to Macula Greek tokens.

## Projects

- `source/MaculaScripta.Contracts` contains dependency-free domain records.
- `source/MaculaScripta.Core` contains gloss resolution, lemma frequency ranking, and lemma audio binding.
- `source/protos/macula_scripta.proto` is a proposed gRPC contract, not used by the reader or either C# project. There is deliberately no `Grpc.Tools` project or generated client/server until an actual transport implementation needs it.
- `data/macula-greek` is the pinned [Macula Greek](https://github.com/Clear-Bible/macula-greek) Git submodule.
- `data/macula-hebrew` is the pinned [Macula Hebrew](https://github.com/Clear-Bible/macula-hebrew) Git submodule (Old Testament, `/ot/`, rendered the same way, right-to-left).
- `site/` is the Hugo reader, with the original overlay editor and recorder at `/demo/`.

Build the C# projects with:

```sh
dotnet build MaculaScripta.slnx
```

## Greek New Testament reader

The homepage and `/nt/JHN/` display the first chapter of **John** as continuous
Greek text, retaining the upstream punctuation. All 27 books are navigable, one
chapter per page (for example, `/nt/JHN/2/`). Hugo renders every chapter's HTML from the
upstream TSV, so the reader works without JavaScript. Each Greek word is a link to a CSS `:target` details pane holding its full
source metadata, hovering shows a gloss tooltip, a switch hides the ruby
annotations, and a copy button copies the plain Greek text.
Glosses are word-level aids, not a running Bible translation. The reader reuses
the workbench's light/dark CSS. The existing John 1:1 workbench remains available
at `/demo/` and `/john-1-1/`.

There is no import step and no generated data is committed. `site/hugo.toml` mounts
`data/macula-greek/SBLGNT/tsv` (the git submodule) as Hugo assets, and
`site/layouts/partials/testament-data.html` reads `macula-greek-SBLGNT.tsv` with
`transform.Unmarshal`, grouping words by book and chapter. `reader-chapter.html` renders a
chapter (text plus each word's details pane listing every TSV field unchanged); `testament-publish.html` also writes it as `nt-data/<book>/<chapter>.html`. Each word (with its trailing
punctuation) is an inline-block token, so words stay whole and only wrap when wider than
the line, while verses still flow together in one paragraph per chapter (the TSV carries
no paragraph-break data).

Reading is continuous in both directions: as the "Next chapter" link (or a sentinel above the
text) nears the viewport, `reader.js` fetches the neighbouring chapter's HTML fragment and
inserts it, continuing into the next book going down and stopping at chapter 1 going up.
Inserted chapters get a heading and ids prefixed `<book>.<chapter>.`; the link remains a plain
fallback link without JavaScript. `site/data/nt/catalog.yaml`
lists the books and chapter counts.

The sticky book bar keeps the current full book title and a `⋯` settings menu in reach
while scrolling. Open the bar to choose a book, then a chapter; book tiles use
three-letter abbreviations by default. The settings view uses a two-column layout and
includes a full-name tile toggle, reading controls, demo, and offline mode. The reader
saves the last visible verse in browser storage and resumes there on return. By default,
the service worker keeps the three most recently read chapter files; enabling
**Offline reading** retains opened reader pages and chapter files as they are accessed,
without downloading the entire New Testament.

```sh
git submodule update --init --depth 1 data/macula-greek
git -C data/macula-greek sparse-checkout set SBLGNT/tsv
# Hebrew Old Testament (the TSV is in Git LFS: needs git-lfs)
git submodule update --init --depth 1 data/macula-hebrew
git -C data/macula-hebrew sparse-checkout set WLC/tsv
git -C data/macula-hebrew lfs pull --include=WLC/tsv/macula-hebrew.tsv
hugo --source ./site --minify
```

A full build renders about 1,300 chapters and takes several minutes. For a quick preview
build only a few books: `HUGO_PARAMS_SAMPLE=true hugo --source ./site --minify` (books listed in
`sampleBooks` in `site/hugo.toml`). Pull request builds use the sample automatically; the
`sample` input of the workflow does the same for manual runs and can never be published.
The tests that walk every chapter need a full build.

Dependabot proposes weekly submodule updates (`.github/dependabot.yml`), so the
published data tracks upstream through reviewed pull requests; the submodule pointer
pins the exact upstream commit. Review upstream changes and licensing before merging.
`site/public/` is build output and is not committed. Validate with:

```sh
hugo --source ./site --minify
node --test tests/*.test.mjs
```

Data attribution: **MACULA Greek Linguistic Datasets**, available at
https://github.com/Clear-Bible/macula-greek/, © 2022–2024 Biblica, Inc.,
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The SBL Greek New
Testament is edited by Michael W. Holmes (Society of Biblical Literature and
Logos Bible Software), CC BY 4.0. English and Chinese Cherith glosses are
© 2023 Andi Wu / Cherith Analytics, CC BY 4.0; Berean glosses are public domain.
The site reorganizes the upstream TSV without editing its word fields.
See the [upstream source notices and license](https://github.com/Clear-Bible/macula-greek/blob/main/LICENSE.md)
for all included annotations and sources.

## YAML overlays

Add language-specific files under `site/data/overlays/<language>/`. Each file contains an `attribution` string and a `verses` list of `VerseTranslationOverlay` records. Hugo loads these files at build time; use the snake_case field names from `source/protos/macula_scripta.proto`. Alignment entries carry their associated source-occurrence `target_macula_ids`, while a target word may map to multiple occurrences or none. These IDs are for alignment only; multi-edit matching uses target language, lemma ID, and sense ID.

Keep only supported data files in that directory, not Markdown documentation: Hugo attempts to parse every file there as data.

Each item in `verses` follows the `VerseTranslationOverlay` contract:

- `verse_ref`, `language_code`, `translation_id`, `revision`
- `current_review_stage`, `review_history`
- `alignments`, each containing `id`, `target_text`, `target_macula_ids`, and `alignment_type`
- Optional alignment fields: `alternates`, `pronunciations`, `translator_notes`, and `custom_metadata`

For raw manuscript retrieval, configure `params.rawManuscriptBaseURL` in `site/hugo.toml` and set `raw_manuscript_path` on an overlay to a path relative to that base URL. The browser emits the fetched text as a `manuscriptloaded` event; parsing and alignment remain the responsibility of the C# engine.

Include Macula dataset attribution with published identifiers: Macula Greek dataset (SBLGNT base), CC BY 4.0.

The seed data in `site/data/overlays/en/JHN_1.yaml` and
`site/data/overlays/yue/JHN_1.yaml` covers John 1:1–5. Jyutping entries are
rendered as Ruby text above Cantonese translation blocks.

Use `MaculaBaseToken.DataAttribution` when publishing Macula identifiers.

## Unified language workbench

The `/demo/` page combines the John 1:1 transformation, editable John 1:1–5
translations, and the field recorder in one workspace. Existing `john-1-1/`
links open the same workspace through a shared Hugo partial.

Cycle through Greek with IPA, English word order (including the inserted
`[the]`), and Cantonese with Jyutping.
Playback advances every seven seconds; pausing preserves the remaining time.
Reduced-motion users start paused, and all stages remain readable without JavaScript.
Opening an editor or recorder, or focusing the translation studio, pauses playback
so it does not distract from editing.

In **Edit translations**, filter by passage and language, select the pencil icon,
and review how many cards will change before saving. **Word details** exposes
alignment metadata, notes, pronunciation audio, and alternates on touch devices
and with the keyboard. Filters do not restrict shared edits.

Select a word's **●** record icon (or **pencil → Record pronunciation**) to prefill the recorder with its
aligned Greek, translation, and Macula references, or use **Record & dictionary**
to start independently. The card's **▶** button plays its linked clip; words without
audio show the record icon instead. A **▶** button appears beside a verse title
only when that language's verse has recordings. It plays available clips in the
current card order, skipping unrecorded words with a 180 ms pause between clips.
Press it again to stop; editing, rearranging cards, or starting other playback
also stops the sequence.

When a verse has no recordings, its title shows a **●** record button instead
of **▶**; **●** stays beside **▶** until every translated word in the verse has audio.
It opens **Verse clips**: record the whole verse, then select each word (shown
with its translation, Greek source word, and source lemma) to trim its clip from
the verse recording. Selecting the first word skips the quiet audio at the start
of the recording and highlights the next 0.5 s, zoomed to a 1 s view; each later
word starts where the closest earlier trimmed word ended (also skipping any quiet
gap) and highlights the next 0.5 s. Drag the selection edges or type start/end
times, use **−**, **+**, **Fit**, and **Scroll** to zoom the waveform, then
**Save clip** to store it and move to the next word. Words that already have audio
are marked ✓ and can still be selected to replace their audio. Each clip is linked to every card with the same language,
source lemma(s), and translated word (case-insensitive) in any verse, plus cards
sharing its language/lemma/sense key, so one verse recording fills in many others.
Untranslated cards are linked only to themselves. The verse recording is kept for
the current page session; once the verse is complete, **✂** beside the verse title
reopens it.

Each verse title shows an audio coverage strip with one cell per card: an outlined
cell is untranslated, a grey cell is translated but missing audio, and a green cell
has audio (including clips shared from other verses). Select a grey cell to open
**Verse clips** for that verse; after recording, that word is selected first. The
**Best next verse to record** card above the verses recommends the verse whose
missing words would fill the most gaps across all loaded verses, using the same
clip linking as **Verse clips**. Ties go to the verse needing fewer clips, then the
earliest verse. It shows the clips needed, the gaps they fill, and a before/after
preview; when every translated word has audio it shows **Complete**. Coverage is
computed in the browser during idle time from the loaded cards and saved clips,
without decoding audio. Run its tests with `node --test tests/*.test.mjs`.

In the field recorder, a draft is not replaced without confirmation. Record audio,
watch the live microphone waveform,
drag the waveform edges to trim, preview the clip, add IPA using the symbol
keyboard, and save the entry locally. The dictionary supports searching,
playback, deletion, and JSON export including WAV audio encoded as base64.
Text edits have their own JSON export. For FLEx dictionary exchange, use the
separate LIFT controls described below; there is no live FLEx/Language Forge connection.

Each Greek source occurrence has its own card in the seed overlays. Expand
**Word details** for source lemma and a short definition, Strong's ID, part of speech,
Macula IDs, and arrangement controls. Definitions in
`site/data/greek_lemma_definitions.yaml` are brief English glosses of the source
lemmas, not word-sense assignments. **Join next**
combines neighboring cards; **Split** restores their constituent cards and lets
you review each translation before saving. Joined phrases do not inherit a
single word's lemma/sense metadata. The arrow buttons change card order within
the same verse and language. Joins can be nested and split again; source IDs are
preserved. Untranslated source words have empty translation text; their Greek
and cards remain visible. Empty text can be saved in both edit and split dialogs.
Arrangements persist offline and are included as `card-layout` records in text
edit exports. Existing phrase edits remain on their original semantic-head IDs;
review their wording after the initial word-card split.

### FLEx dictionary exchange (LIFT 0.13)

In **Record & dictionary → Dictionary**, enter lexical and gloss writing-system
tags matching your FLEx project (for example `grc` and `en`, or `yue-Hant`).
IPA uses the lexical tag plus `-fonipa`. These settings apply to new local
records on export; imported records retain their selected writing-system tags.

- **Export LIFT + audio ZIP** exports the **whole dictionary**, regardless of
  search filters. Extract the ZIP, keep its `audio/` folder alongside
  `macula-dictionary.lift`, and use FLEx's LIFT import. Review writing-system
  and custom-field mappings in FLEx. The ZIP is a transport bundle, not a FLEx
  project backup. Audio is preserved in its original format; FLEx playback
  depends on its installed codecs. JSON export remains available.
- **Import LIFT / ZIP** accepts one UTF-8 `.lift` document plus optional audio
  files selected together, or one ZIP containing a single `.lift` and audio.
  Audio matches relative paths, conventional `audio/` / `AudioVisual/` paths,
  then an unambiguous basename (useful for individually selected audio files).
  Missing audio is reported; existing recordings are retained on update.
  Files stay in the browser; no uploads or external audio fetches occur.
- Import requires confirmation of the **limited projection**. Each top-level
  sense becomes one recorder row. The selected lexical form, selected gloss
  (or definition fallback), IPA, first pronunciation audio, grammatical-info
  as syntax, and `macula-reference`, `macula-morphology`, `macula-syntax`
  custom fields are supported. Syntax exports as `macula-syntax`, not an
  inferred FLEx part of speech. Other languages, rich formatting, additional
  pronunciations/audio, variants, examples, relations, notes, ranges, subsenses,
  and other FLEx metadata are **not retained or re-exported**. Keep original
  FLEx exports/project backups: neither this projection nor its JSON export
  can reconstruct unsupported data.
- Entry/sense IDs (and entry GUIDs when present) survive exchange. Existing
  recorder rows receive persistent IDs on first LIFT export. Repeat imports
  update matching entry/sense IDs atomically; entries absent from the import
  and FLEx deletion markers never delete local data. Entries without IDs need
  a GUID; missing sense IDs receive deterministic, entry-local ordinal IDs.
  Reordering such unidentified senses can change matching. Importing another
  selected language for the same IDs replaces that local projection.
- Validation checks XML well-formedness, LIFT 0.13 structure/identities and
  safety constraints, not the complete LIFT Relax NG schema. Malformed XML,
  DTD/entity declarations, external/traversing audio paths, ambiguous filenames,
  and unsupported ZIP features are rejected before storage changes. ZIP
  supports stored/deflated entries (deflate requires browser
  `DecompressionStream` support); encrypted, split, ZIP64 and symlink archives
  are unsupported. Limits: 8 MiB XML, 32 MiB per file, 128 MiB input/expanded
  ZIP, 2,000 files, 10,000 recorder rows, 150,000 XML elements and depth 40.
  Extract compressed ZIPs if your browser lacks raw-deflate support.

Maintain the demonstration text, annotations, stage labels, and playback duration
in `site/data/john_1_1.yaml`. This illustrative data is separate from the editable
translation overlays. Units are listed in reading order; `source_order` on the
English final clause specifies the Greek order used as the animation's starting
positions. Presentation lives in `site/layouts/transformation.html` and
`site/static/transformation.css`, with shared workspace markup in
`site/layouts/partials/workspace.html` and the illustration in
`site/layouts/partials/transformation-stages.html`; playback lives in
`site/static/transformation.js`.
The Hugo page metadata lives in `site/content/john-1-1.md`.

Build locally with Hugo:

```sh
hugo --source ./site --minify
```

Offline text changes are stored in IndexedDB and can be exported as a JSON patch. The site does not store GitHub credentials or push changes directly.

The alignment page shows Greek beneath each translation using
`site/data/greek_tokens.yaml`, keyed by Macula source-occurrence ID. Add source tokens there when
adding overlays for new verses. Dataset attribution appears once in the footer.

## Shared translation edits (multi-edit)

Expand **Settings** to choose light or dark appearance. In **Edit text**, shared
editing is checked by default each time an editor opens. Its matching key is the combination of:

- Target language: `language_code`
- Dictionary word: `custom_metadata.lemma_id`
- Word sense: `custom_metadata.sense_id`

An edit replaces the text of every card whose three values match exactly.
**Macula IDs are not shared-edit keys**: they identify individual source-word
occurrences for alignment. Matching lemma and sense IDs can link cards across
different verses, but never across target languages. Missing or blank
language, lemma, or sense metadata limits editing to the selected card; senses
are never inferred from spelling, translated text, or source-occurrence IDs.

The John 1:1 Word cards demonstrate this with lemma ID `strong:G3056` and
sense ID `local:logos-divine-word`. The latter is a project-local editorial sense
label, not an external dictionary identifier. Assign both metadata values only
after reviewing a card's meaning and suitability for whole-card replacement.
Larger phrases should remain untagged unless replacing the entire phrase is
intended. Shared edits replace the whole card's text, but preserve existing
pronunciation annotations. Other seed cards remain untagged.
Uncheck shared editing in the editor to edit or record just one card.
Appearance is remembered in this browser.
The latest successfully saved batch is shaded until another edit or a reload;
all saved edits are restored on reload and included in the JSON export.
New exported edits also include their target language, lemma ID, and sense ID.
Previously saved edits are retained as-is; changing the matching rule does not
undo earlier cross-language edits.

Recordings made from the editor use that same scope: matching cards link to one
dictionary audio entry rather than storing duplicate clips. Existing local
recordings are linked using their source references and an unambiguous language
match (including the seed cards' previous phrase glosses), then shared by the
explicit language/lemma/sense key. Ambiguous recordings are not automatically
assigned. Recordings stay in the browser where they were captured; publishing
the site does not upload them. Use dictionary export to back up the audio.

The service worker fetches the latest published pages and assets when online and
falls back to cached copies when offline. If an older installation still shows
the empty page, reload once to activate the updated worker, then reload again to
load the current translations. Offline edits remain in IndexedDB.

## Deploying GitHub Pages

Pushes to `main` automatically deploy the Hugo site. Pull requests build only.
To publish another branch manually:

1. Open **Actions → Deploy Hugo site to GitHub Pages → Run workflow**.
2. Under **Use workflow from**, select the branch to publish.
3. Enable the **publish** boolean, then select **Run workflow**.
   Leave **publish** unchecked for a build-only artifact.

**Publishing replaces the live production site; it does not create a branch
preview.** To restore `main`, repeat these steps with `main` selected and
**publish** enabled.

The repository's **Settings → Pages → Source** must be **GitHub Actions**.
The `github-pages` environment's deployment branch policy must allow the
selected branch. Environment protection rules or required approvals may need
action by a repository owner.

The workflow changes defining the `publish` input must exist on the selected
branch. Merge this PR into the default branch to make that input available in
the default branch's **Run workflow** interface.
