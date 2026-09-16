# Windows enrolment (pack folder)

Pack home for Windows onboarding artefacts. Process, Graph kinds, and Axis capability matrix:

→ **[docs/windows-enrollment.md](../../../docs/windows-enrollment.md)**

## Layout

```text
enrollment/
  autopilot/        Autopilot deployment profiles (tenant export writes here)
  esp/              Enrollment Status Page (planned export)
  restrictions/     Enrolment restrictions (planned)
  windows-hello/    Windows Hello for Business enrolment configs (planned)
```

## Today

| Folder | In template | Tenant export | Kit apply |
| --- | --- | --- | --- |
| `autopilot/` | `.gitkeep` | Yes (`enrollment-autopilot`) | No |
| `esp/` | — | No | No |
| `restrictions/` | — | No | No |
| `windows-hello/` | — | No | No |

Create the planned folders when you start authoring those JSON exports; Axis already treats anything under `windows/enrollment/` as the **Enrolment** pack category.
