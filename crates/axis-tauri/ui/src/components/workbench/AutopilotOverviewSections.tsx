import type { AutopilotOverviewSection } from "../../lib/autopilotProfile";

export function AutopilotOverviewSections({
  sections,
}: {
  sections: AutopilotOverviewSection[];
}) {
  if (sections.length === 0) {
    return (
      <p className="muted" style={{ marginTop: "1rem" }}>
        No Autopilot settings were found on this object.
      </p>
    );
  }

  return (
    <div className="stack" style={{ marginTop: "1rem", gap: "1rem" }}>
      {sections.map((section) => (
        <div key={section.title}>
          <h2 style={{ margin: "0 0 0.25rem", fontSize: "0.85rem" }}>{section.title}</h2>
          {section.description ? (
            <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.75rem" }}>
              {section.description}
            </p>
          ) : null}
          <dl className="meta-grid">
            {section.rows.map((row) => (
              <div key={`${section.title}:${row.label}`}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
