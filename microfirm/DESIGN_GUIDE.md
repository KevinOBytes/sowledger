# DESIGN_GUIDE.md

## Product UX Principles
1. **Confidence first:** Every screen should answer, “Is my firmware safe enough to ship?”
2. **Actionable findings:** Do not just list vulnerabilities; provide impact and next step.
3. **Fast triage:** High severity issues must be visually obvious and filterable in one click.
4. **Evidence-driven:** Show source package/component, CVE reference, and detection method confidence.

## Information Architecture
- **Dashboard:** recent scans, high severity count, scan queue status.
- **Scans:** upload, history, and per-scan status timeline.
- **Findings:** searchable and filterable vulnerability list.
- **Exports:** CSV/JSON reports and webhook delivery logs.
- **Settings:** workspace, API tokens, webhook endpoints, retention policies.

## Visual Design
- Clean SaaS layout with strong hierarchy and dense-but-readable tables.
- Status tokens:
  - Critical: red
  - High: orange
  - Medium: amber
  - Low: slate/gray
- Keep contrast accessible (WCAG AA minimum).

## Component Priorities
- Upload dropzone with clear file constraints.
- Findings table with sticky filters and severity facets.
- Timeline/status component for scan lifecycle.
- Side panel or modal for finding details + remediation.

## Copy Style
- Use direct language.
- Explain risk in plain terms first, technical details second.
- Avoid alarmist messaging; frame findings with confidence and recommendations.
