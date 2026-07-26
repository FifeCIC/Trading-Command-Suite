import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client.js';
import { useState, useMemo } from 'react';
import './FileInventoryPage.css';

export default function FileInventoryPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['file-inventory'],
    queryFn: () => apiGet('/api/system/file-inventory'),
    staleTime: 60_000,
  });

  const [sortKey, setSortKey] = useState('lines');
  const [sortDir, setSortDir] = useState('desc');
  const [filterDir, setFilterDir] = useState('');
  const [filterExt, setFilterExt] = useState('');
  const [hideLibraries, setHideLibraries] = useState(false);
  const [hideSpecial, setHideSpecial] = useState(false);

  const LIBRARY_DIRS = ['node_modules', 'vendor', 'dist', '.next', 'build', '__pycache__'];
  const SPECIAL_DIRS = ['.github', 'docs', 'scripts', 'handoff', 'handoffs'];

  const sortedFiles = useMemo(() => {
    if (!data?.files) return [];
    let list = [...data.files];
    if (hideLibraries) {
      list = list.filter(f => !LIBRARY_DIRS.some(d => f.dir === d || f.dir.startsWith(d + '/')));
    }
    if (hideSpecial) {
      list = list.filter(f => !SPECIAL_DIRS.some(d => f.dir === d || f.dir.startsWith(d + '/')));
    }
    if (filterDir) list = list.filter(f => f.dir.startsWith(filterDir));
    if (filterExt) list = list.filter(f => f.ext === filterExt);
    list.sort((a, b) => {
      const aVal = a[sortKey] ?? 0;
      const bVal = b[sortKey] ?? 0;
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [data, sortKey, sortDir, filterDir, filterExt, hideLibraries, hideSpecial]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortIndicator = (key) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const dirs = useMemo(() => {
    if (!data?.byDir) return [];
    return Object.keys(data.byDir).sort();
  }, [data]);

  const exts = useMemo(() => {
    if (!data?.byExt) return [];
    return Object.keys(data.byExt).sort();
  }, [data]);

  if (isLoading) return <div className="file-inventory-page"><p>Scanning project files…</p></div>;
  if (error || !data) return <div className="file-inventory-page"><p className="risk-high">Failed to load file inventory.</p></div>;

  return (
    <div className="file-inventory-page">
      <header className="fi-header">
        <h2>File Inventory</h2>
        <p className="muted">
          {data.totalFiles.toLocaleString()} files · {data.totalLines.toLocaleString()} total lines · {formatSize(data.totalSize)}
          {' · '}Generated {new Date(data.generatedAt).toLocaleString()}
        </p>
      </header>

      {/* ── Summary by extension ── */}
      <section className="fi-summary">
        <h3>By Extension</h3>
        <div className="fi-summary-grid">
          {exts.map(ext => (
            <div key={ext} className="fi-summary-card" onClick={() => { setFilterExt(ext); setFilterDir(''); }}>
              <span className="fi-summary-ext">{ext}</span>
              <span className="fi-summary-count">{data.byExt[ext].count} files</span>
              <span className="fi-summary-lines">{data.byExt[ext].lines.toLocaleString()} lines</span>
              <span className="fi-summary-size">{formatSize(data.byExt[ext].size)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Summary by directory ── */}
      <section className="fi-summary">
        <h3>By Directory</h3>
        <div className="fi-summary-grid">
          {dirs.map(d => (
            <div key={d} className="fi-summary-card" onClick={() => { setFilterDir(d); setFilterExt(''); }}>
              <span className="fi-summary-ext">{d || '(root)'}</span>
              <span className="fi-summary-count">{data.byDir[d].count} files</span>
              <span className="fi-summary-lines">{data.byDir[d].lines.toLocaleString()} lines</span>
              <span className="fi-summary-size">{formatSize(data.byDir[d].size)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Filters ── */}
      <div className="fi-filters">
        <label className="fi-filter-toggle">
          <input type="checkbox" checked={hideLibraries} onChange={e => setHideLibraries(e.target.checked)} />
          Hide libraries (node_modules, vendor, dist)
        </label>
        <label className="fi-filter-toggle">
          <input type="checkbox" checked={hideSpecial} onChange={e => setHideSpecial(e.target.checked)} />
          Hide special (.github, docs, scripts)
        </label>
        {(filterDir || filterExt) && (
          <span className="fi-filter-badge">
            Filtered: {filterExt ? `ext=${filterExt}` : ''}{filterDir ? ` dir=${filterDir}` : ''}
            <button onClick={() => { setFilterDir(''); setFilterExt(''); }} className="fi-filter-clear">✕ clear</button>
          </span>
        )}
      </div>

      {/* ── File table ── */}
      <section className="fi-table-wrap">
        <table className="fi-table">
          <thead>
            <tr>
              <th onClick={() => toggleSort('relativePath')} className="fi-sortable">File{sortIndicator('relativePath')}</th>
              <th onClick={() => toggleSort('ext')} className="fi-sortable">Ext{sortIndicator('ext')}</th>
              <th onClick={() => toggleSort('lines')} className="fi-sortable fi-num">Lines{sortIndicator('lines')}</th>
              <th onClick={() => toggleSort('size')} className="fi-sortable fi-num">Size{sortIndicator('size')}</th>
              <th onClick={() => toggleSort('lastModified')} className="fi-sortable">Modified{sortIndicator('lastModified')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedFiles.map(f => (
              <tr key={f.relativePath} className={f.lines > 500 ? 'fi-bloated' : ''}>
                <td className="fi-path" title={f.relativePath}>{f.relativePath}</td>
                <td className="fi-ext">{f.ext}</td>
                <td className="fi-num">{f.lines.toLocaleString()}</td>
                <td className="fi-num">{formatSize(f.size)}</td>
                <td className="fi-date">{new Date(f.lastModified).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
