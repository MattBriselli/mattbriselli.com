# Matt L. Briselli — Personal Website

A minimalist, editorial personal website and stitched Curriculum Vitae built with semantic HTML, modern CSS, vanilla JavaScript, and machine-readable SEO / AI Agent feeds—zero build steps required.

## Files & Architecture

- [`index.html`](./index.html) — Main website and interactive stitched CV (Software Engineering & TPM, Chemistry & Evo-Devo Biology, and Theatre Stage Management & Circus Arts), embedded with Schema.org `ProfilePage` + `Person` JSON-LD.
- [`styles.css`](./styles.css) — Layered modern CSS (`@layer base, theme, layout, components, utilities;`) with warm editorial paper light mode, deep ink dark mode, and `@media print` resume styling.
- [`script.js`](./script.js) — System-aware two-state theme toggle, discipline CV filter chips, and print/PDF handler.
- [`llms.txt`](./llms.txt) — Structured Markdown overview for LLMs, AI search engines, and recruiting agents.
- [`resume.json`](./resume.json) — Machine-readable JSON Resume and agent discovery profile.
- [`AGENTS.md`](./AGENTS.md) — Workspace rule instructions for keeping recent work synchronized across Antigravity projects.

## Local Preview

```sh
python3 -m http.server 8080
```
