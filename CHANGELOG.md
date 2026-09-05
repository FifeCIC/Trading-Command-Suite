# Changelog

All notable changes to this project will be documented in this file.

The format is based on "Keep a Changelog" and this file is intended for humans and automation (release drafter, CI).  

## [Unreleased]
- fix: webhooks.service — replace `require('crypto')` with top-level import, include error details when HMAC validation fails, and avoid `require-await` by returning a resolved Promise from `queueProcessing`. (commit d2d9c8b7)
- chore: add `.github/ci-trigger.txt` placeholder used to nudge workflows after lint/type fixes. (commit 1791d827)
- fix: watchlists.controller — remove unused imports, add safe JSON parsing and type guards, and reduce `any` usage in DB writes and sync logic. (commit 2beac86e)

## Release notes
- When ready, update the Unreleased section with a version header (e.g. `## [1.2.3] - 2026-09-05`) and move entries under it.

---

Generated and committed by GitHub Copilot to record recent CI/lint fixes and small hygiene changes.