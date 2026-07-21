# Handoff: Fix guardrails.json PowerShell variable expansion

**Date:** 2026-07-18
**Agent:** GitHub Copilot (DeepSeek V4 Pro)
**Scope:** `.github/hooks/guardrails.json`

## Problem

Hundreds of PowerShell parser errors per day:
```
try {  = [Console]::In.ReadToEnd(); if () {  =  | ConvertFrom-Json; ...
```
`$raw`, `$j`, `$tool`, `$cmd` were being expanded to empty strings by the parent PowerShell shell before `powershell.exe` received them.

## Root Cause

The `PreToolUse` hook command used double quotes for the `-Command` argument:
```
powershell -NoProfile -Command "try { $raw = ... }"
```

When GitHub Copilot executes this via the PowerShell-integrated terminal, the parent PowerShell shell expands `$raw`, `$j`, `$tool`, `$cmd` (all undefined → empty strings) before invoking `powershell.exe`.

## Fix

Escaped all `$` signs with PowerShell backtick escape (`` `$ ``):
```
powershell -NoProfile -Command "try { `$raw = [Console]::In.ReadToEnd(); ..."
```

The backtick tells the parent shell to treat `$raw` as a literal, passing it intact to the child `powershell.exe`.

## Files Changed

- `.github/hooks/guardrails.json` — Added backtick escapes before all `$` variable references in the PreToolUse hook command.
