# Copilot instructions

Push an update to GitHub Pages through GitHub Actions after updates to a webpage have been finalised, and raise a pull request at the end of any Copilot session where changes were made to files in the repository.

- Publish with the **Deploy Hugo site to GitHub Pages** workflow (`.github/workflows/hugo.yml`): trigger `workflow_dispatch` on the working branch with the `publish` input set to `true`, then confirm both the `build` and `deploy` jobs succeed.
- Name every branch you create `copilot/<short-description>`. Do not apply this to branches a human created or asked for by name.
- Before publishing, build the site locally with Hugo: `hugo --source ./site --minify`.
