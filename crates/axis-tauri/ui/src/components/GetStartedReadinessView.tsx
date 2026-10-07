import { useEffect, useState } from "react";
import {
  ENROLLMENT_LIMIT_RESTRICTIONS_PATH,
  ENROLLMENT_PLATFORM_RESTRICTIONS_PATH,
} from "../lib/enrollment";
import { navigate } from "../lib/route";
import {
  fetchIntuneReadiness,
  fetchUserReadiness,
  searchReadinessUsers,
  type ReadinessReport,
  type ReadinessRow,
  type ReadinessSection,
  type ReadinessUserHit,
  type UserReadinessReport,
} from "../lib/tauri";
import { PageHeader } from "./ui/PageChrome";

function statusLabel(status: string): string {
  if (status === "pass") return "Ready";
  if (status === "warn") return "Review";
  if (status === "fail") return "Not ready";
  return "";
}

function pillTone(value: string, status: string): string {
  if (value === "Allow" || value === "Valid" || value === "In group" || status === "pass") return "pass";
  if (value === "Block" || value === "Not valid" || status === "fail") return "fail";
  if (status === "warn") return "warn";
  return "info";
}

function Pill({ value, status }: { value: string; status: string }) {
  return <span className={`readiness-pill is-${pillTone(value, status)}`}>{value}</span>;
}

function rowsOf(section: ReadinessSection, kind: string): ReadinessRow[] {
  return section.rows.filter((row) => (row.kind || "fact") === kind);
}

function ReadinessBody({ section }: { section: ReadinessSection }) {
  const facts = rowsOf(section, "fact");
  const stats = rowsOf(section, "stat");
  const groups = rowsOf(section, "group");
  const domains = rowsOf(section, "domain");
  const platforms = rowsOf(section, "platform");
  const overrides = rowsOf(section, "override");
  const licenses = rowsOf(section, "license");
  const results = rowsOf(section, "result");
  return (
    <>
      {stats.length ? (
        <div className="readiness-stats">
          {stats.map((row) => (
            <div key={row.label} className={`readiness-stat is-${row.status}`}>
              <span className="muted">{row.label}</span>
              <strong>{row.value}</strong>
              {row.detail ? <span className="muted">{row.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
      {facts.length ? (
        <dl className="readiness-facts">
          {facts.map((row) => (
            <div key={row.label}>
              <dt className="muted">{row.label}</dt>
              <dd>
                <Pill value={row.value} status={row.status} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {groups.length ? (
        <ul className="readiness-chips">
          {groups.map((row) => (
            <li key={row.label} className={`readiness-chip is-${pillTone(row.value, row.status)}`}>
              <span>{row.label}</span>
              <span className="muted">{row.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {domains.length ? (
        <table className="axis-table readiness-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>CNAME</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>
                  <Pill value={row.value} status={row.status} />
                  {row.detail ? <p className="muted readiness-detail">{row.detail}</p> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {platforms.length ? (
        <table className="axis-table readiness-table">
          <thead>
            <tr>
              <th>Platform</th>
              <th>MDM</th>
              <th>Personally owned</th>
            </tr>
          </thead>
          <tbody>
            {platforms.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>
                  <Pill value={row.value} status={row.value === "Block" ? "fail" : "pass"} />
                </td>
                <td>
                  <Pill value={row.detail || "—"} status={row.detail === "Block" ? "fail" : "pass"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {overrides.length ? (
        <table className="axis-table readiness-table">
          <thead>
            <tr>
              <th>Restriction</th>
              <th>MDM</th>
              <th>Assignment</th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((row) => (
              <tr key={`${row.label}:${row.detail ?? ""}`}>
                <td>{row.label}</td>
                <td>
                  <Pill value={row.value} status={row.status === "warn" || row.value === "Block" ? "fail" : "pass"} />
                </td>
                <td>{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {rowsOf(section, "userPlatform").length ? (
        <table className="axis-table readiness-table">
          <thead>
            <tr>
              <th>Platform</th>
              <th>MDM</th>
              <th>Applies because</th>
            </tr>
          </thead>
          <tbody>
            {rowsOf(section, "userPlatform").map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>
                  <Pill
                    value={row.value}
                    status={row.status === "fail" ? "fail" : row.value === "Allow" ? "pass" : "info"}
                  />
                </td>
                <td>{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {results.length ? (
        <ul className="readiness-results">
          {results.map((row) => (
            <li key={row.label}>
              <Pill value={row.value} status={row.status} />
              <div>
                <strong>{row.label}</strong>
                {row.detail ? <p className="muted">{row.detail}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {licenses.length ? (
        <table className="axis-table readiness-table">
          <thead>
            <tr>
              <th>License</th>
              <th>Plan</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {licenses.map((row) => (
              <tr key={`${row.label}:${row.value}`}>
                <td>{row.label}</td>
                <td>{row.value}</td>
                <td>
                  <Pill value={row.detail || row.value} status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

function ReadinessCard({
  section,
  action,
  wide,
}: {
  section: ReadinessSection;
  action?: { label: string; href: string };
  wide?: boolean;
}) {
  return (
    <section className={`readiness-card is-${section.status}${wide ? " is-wide" : ""}`}>
      <header>
        <h2>{section.title}</h2>
        <span className={`readiness-pill is-${section.status}`}>{statusLabel(section.status)}</span>
      </header>
      <p>{section.summary}</p>
      <ReadinessBody section={section} />
      {action ? (
        <button type="button" className="axis-btn" onClick={() => navigate(action.href)}>
          {action.label}
        </button>
      ) : null}
    </section>
  );
}

export function GetStartedReadinessView() {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<ReadinessUserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [userReport, setUserReport] = useState<UserReadinessReport | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchIntuneReadiness();
      setReport(response.report);
      setError(response.error);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : "Could not run the readiness check.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function search() {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setUsers([]);
      setSearchError("Enter at least two characters.");
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const response = await searchReadinessUsers(trimmed);
      setUsers(response.users);
      setSearchError(response.error ?? (response.users.length ? null : "No users matched."));
    } catch (err) {
      setUsers([]);
      setSearchError(err instanceof Error ? err.message : "Could not search users.");
    } finally {
      setSearching(false);
    }
  }

  async function chooseUser(user: ReadinessUserHit) {
    setSelectedId(user.id);
    setUserLoading(true);
    setUserError(null);
    setUserReport(null);
    try {
      const response = await fetchUserReadiness(user.id);
      setUserReport(response.report);
      setUserError(response.error);
    } catch (err) {
      setUserError(err instanceof Error ? err.message : "Could not check this user.");
    } finally {
      setUserLoading(false);
    }
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Get Started"
        title="Readiness"
        description="Checks automatic enrollment, CNAME validation, and device platform restrictions, then checks one user against the Some groups, device limit, and Intune license."
        onRefresh={() => void load()}
        refreshing={loading}
      />
      <div className="axis-panel axis-panel-padded get-started readiness">
        {error ? <div className="axis-alert axis-alert-danger">{error}</div> : null}
        {loading && !report ? <p className="muted">Checking the tenant…</p> : null}
        {report ? (
          <div className="readiness-grid">
            <ReadinessCard section={report.automaticEnrollment} />
            <ReadinessCard section={report.cname} />
            <ReadinessCard
              section={report.platformRestrictions}
              wide
              action={{ label: "Open device platform restrictions", href: ENROLLMENT_PLATFORM_RESTRICTIONS_PATH }}
            />
          </div>
        ) : null}

        <section className="stack" style={{ gap: "0.75rem" }}>
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Check a user</h2>
          <p className="muted" style={{ margin: 0 }}>
            When automatic enrollment is Some, this checks whether the user is in those groups. It also applies device platform restrictions, the device limit, and an Intune license.
          </p>
          <form
            className="readiness-search"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <label className="device-field">
              User
              <input
                className="axis-input"
                value={query}
                placeholder="Name or email"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="submit" className="axis-btn axis-btn-primary" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
          </form>
          {searchError ? <p className="muted">{searchError}</p> : null}
          {users.length ? (
            <ul className="readiness-users">
              {users.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    className="axis-btn readiness-user"
                    aria-pressed={selectedId === user.id}
                    onClick={() => void chooseUser(user)}
                  >
                    <span>{user.displayName}</span>
                    <span className="muted">{user.userPrincipalName}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {userLoading ? (
            <p className="muted">
              Checking {users.find((user) => user.id === selectedId)?.displayName ?? "user"}…
            </p>
          ) : null}
          {userError ? <div className="axis-alert axis-alert-danger">{userError}</div> : null}
          {userReport ? (
            <div className="readiness-grid">
              <p className="readiness-user-heading">
                {userReport.displayName}
                {userReport.userPrincipalName ? (
                  <span className="muted"> · {userReport.userPrincipalName}</span>
                ) : null}
              </p>
              <ReadinessCard section={userReport.result} wide />
              <ReadinessCard section={userReport.automaticEnrollment} />
              <ReadinessCard
                section={userReport.deviceLimit}
                action={{ label: "Open device limit restrictions", href: ENROLLMENT_LIMIT_RESTRICTIONS_PATH }}
              />
              <ReadinessCard
                section={userReport.platformRestrictions}
                wide
                action={{ label: "Open device platform restrictions", href: ENROLLMENT_PLATFORM_RESTRICTIONS_PATH }}
              />
              <ReadinessCard section={userReport.licenses} />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
