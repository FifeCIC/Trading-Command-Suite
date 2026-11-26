import { STANDARDS, standardsByStatus } from '../data/standards';
import './standards.css';

/**
 * StandardsPage — every standard this project CLAIMS, and the gate that proves each one.
 *
 * ⚠️ NOTHING ON THIS PAGE IS TYPED. The list, the counts and the status of every row come from
 * `src/data/standards.js`, and that manifest is checked by `scripts/validate-standards.cjs` in
 * `prebuild` — a standard whose gate file is missing, or that nothing calls, fails the build rather
 * than quietly rendering as met here. A page that restated the list would be the exact defect the
 * list exists to prevent: a claim somebody has to remember to keep true.
 *
 * ⚠️ AND THE STATUS IS NOT A FIELD. There is no `status: 'passing'` in the manifest to drift out of
 * date; "enforced" MEANS the gate is named and wired, and the absence of a gate is shown as a gap
 * with the reason the author wrote. `standardsByStatus()` is the one place that distinction lives.
 *
 * The same list is published to the public README as a GENERATED block
 * (`node scripts/validate-standards.cjs --write-badges`), so this page and the repository front page
 * cannot disagree — the build fails if the committed block is stale.
 */
export default function StandardsPage() {
  const { met, gaps } = standardsByStatus();

  return (
    <div className="std-page">
      <header className="std-header">
        <h2>Engineering Standards</h2>
        <p className="std-lede">
          {STANDARDS.length} standards declared · <strong>{met.length} backed by a gate</strong>
          {gaps.length > 0 ? <> · <strong>{gaps.length} declared gap{gaps.length === 1 ? '' : 's'}</strong></> : null}
        </p>
        <p className="std-note">
          A badge here is an assertion the build checks: every enforced row names a file that exists and
          that an npm script actually calls. A standard with no gate is shown as a gap with its reason,
          because hiding it would read as met.
        </p>
      </header>

      {gaps.length > 0 && (
        <section className="std-gaps">
          <h3>Not checked yet</h3>
          {gaps.map((s) => (
            <article key={s.id} className="std-gap">
              <h4>{s.name}</h4>
              <p className="std-gap-why">{s.why}</p>
              <p className="std-gap-reason"><strong>Why there is no gate:</strong> {s.gap}</p>
            </article>
          ))}
        </section>
      )}

      <section>
        <h3>Enforced</h3>
        <table className="std-table">
          <thead>
            <tr>
              <th scope="col">Standard</th>
              <th scope="col">Gate</th>
              <th scope="col">When</th>
              <th scope="col">Verify with</th>
            </tr>
          </thead>
          <tbody>
            {met.map((s) => (
              <tr key={s.id}>
                <th scope="row">
                  <span className="std-name">{s.name}</span>
                  <span className="std-why">{s.why}</span>
                </th>
                <td className="std-file">{s.gate}</td>
                <td className="std-when">{s.enforcedIn}</td>
                <td className="std-verify">
                  {s.verify ? <code>{s.verify}</code> : <span className="std-none">not a command</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer className="std-footer">
        <p>
          The public repository states the same list, generated from this manifest with
          <code> node scripts/validate-standards.cjs --write-badges</code>. A stale copy fails the build.
        </p>
      </footer>
    </div>
  );
}
