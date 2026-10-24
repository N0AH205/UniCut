# Contributing

Bug reports, documentation improvements, and focused pull requests are welcome.

## Reporting a problem

Include your operating system, Python version, selected settings, steps to
reproduce, and any error message. For image-quality issues, include a small
reproducible image only if you have permission to share it. Do not post private
photos, access tokens, or other sensitive information.

Explain the expected result and what happened instead. For security problems,
follow [SECURITY.md](SECURITY.md).

## Making a change

1. Fork the repository and create a branch for your change.
2. Follow the [developer setup instructions](docs/DEVELOPMENT.md).
3. Keep changes focused and follow the existing Python and vanilla JavaScript style.
4. Add regression coverage for meaningful behavior changes and run the checks below.
5. Explain the problem, the change, and how you verified it in your pull request.

```bash
python -m unittest discover -s tests -v
node --test tests/refinement.test.cjs
node --check static/js/app.js
node --check static/js/canvas.js
node --check static/js/api.js
node --check static/js/floating-panels.js
```

For changes to image quality, include before/after examples and settings. Unit
tests alone do not establish better extraction quality. Do not commit model
weights, environments, personal images, or generated exports.

By contributing, you agree to license your original contribution under this
project's MIT License. Preserve upstream notices for any third-party material.
