import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, ChevronDown, ClipboardList, FolderKanban,
  HeartPulse, LayoutDashboard, Play, Search,
  Settings, ShieldCheck, UserRound, X,
} from 'lucide-react';
import { agentApi, apiMode } from '../../api/agentApi.js';

const secondaryNavItems = [
  { label: 'Cases', icon: FolderKanban },
  { label: 'Patients', icon: UserRound },
  { label: 'Activity', icon: HeartPulse },
  { label: 'Approvals', icon: ClipboardList, count: 4 },
  { label: 'Settings', icon: Settings },
];

const defaultProfile = {
  name: 'Jordan Diaz',
  role: 'Operations',
  email: 'jordan.diaz@example.com',
};

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef(null);
  const noticeTimerRef = useRef(null);

  const [notice, setNotice] = useState(null);
  const [headerBusy, setHeaderBusy] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchCases, setSearchCases] = useState([]);
  const [searchLoaded, setSearchLoaded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(() => {
    try {
      const stored = window.localStorage.getItem('name-tbd-profile');
      return stored ? { ...defaultProfile, ...JSON.parse(stored) } : defaultProfile;
    } catch {
      return defaultProfile;
    }
  });
  const [profileDraft, setProfileDraft] = useState(profile);

  const showNotice = (message, type = 'success') => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice({ message, type });
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3200);
  };

  useEffect(() => {
    const handleNotice = (event) => {
      const detail = event.detail || {};
      showNotice(detail.message || 'Action completed.', detail.type || 'success');
    };

    window.addEventListener('app:notice', handleNotice);
    return () => {
      window.removeEventListener('app:notice', handleNotice);
      window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleSlash = (event) => {
      if (event.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        event.preventDefault();
        searchRef.current?.focus();
      }

      if (event.key === 'Escape') {
        setSearchOpen(false);
        setProfileOpen(false);
      }
    };

    window.addEventListener('keydown', handleSlash);
    return () => window.removeEventListener('keydown', handleSlash);
  }, []);

  const filteredSearchCases = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return searchCases.slice(0, 5);

    return searchCases
      .filter((item) => {
        const searchable = [
          item.case_id,
          item.patient?.patient_id,
          item.patient?.name,
          item.patient?.mrn,
          item.issue,
          item.status,
          item.risk?.level,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return searchable.includes(query);
      })
      .slice(0, 7);
  }, [searchCases, searchTerm]);

  async function ensureSearchCasesLoaded() {
    if (searchLoaded || searchLoading) return searchCases;

    setSearchLoading(true);
    try {
      const response = await agentApi.getCases();
      const loaded = response.cases || [];
      setSearchCases(loaded);
      setSearchLoaded(true);
      return loaded;
    } catch (error) {
      showNotice(`Search failed: ${error.message}`, 'error');
      return [];
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleSearchFocus() {
    setSearchOpen(true);
    await ensureSearchCasesLoaded();
  }

  async function handleSearchSubmit(event) {
    event.preventDefault();
    const loaded = await ensureSearchCasesLoaded();
    const query = searchTerm.trim().toLowerCase();

    const match = (query ? loaded : filteredSearchCases).find((item) => {
      if (!query) return true;
      const searchable = [
        item.case_id,
        item.patient?.patient_id,
        item.patient?.name,
        item.patient?.mrn,
        item.issue,
        item.status,
        item.risk?.level,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(query);
    });

    if (!match) {
      showNotice(`No case matched “${searchTerm.trim()}”.`, 'error');
      return;
    }

    navigate(`/cases/${match.case_id}`);
    setSearchTerm('');
    setSearchOpen(false);
  }

  function selectSearchResult(item) {
    navigate(`/cases/${item.case_id}`);
    setSearchTerm('');
    setSearchOpen(false);
  }

  async function handleHeaderRunAgent() {
    if (headerBusy) return;

    if (location.pathname.startsWith('/cases/')) {
      showNotice('Run request sent to the current case.', 'info');
      window.dispatchEvent(new CustomEvent('app:run-agent'));
      return;
    }

    setHeaderBusy(true);
    try {
      const response = await agentApi.getCases();
      const readyCase = response.cases?.find((item) => item.status === 'READY');

      if (!readyCase) {
        showNotice('There are no READY cases available to run right now.', 'error');
        return;
      }

      showNotice(`Opening ${readyCase.patient.patient_id} and starting the agent.`);
      navigate(`/cases/${readyCase.case_id}`, { state: { autoRun: true } });
    } catch (error) {
      showNotice(`Could not start the agent: ${error.message}`, 'error');
    } finally {
      setHeaderBusy(false);
    }
  }

  function openProfile() {
    setProfileDraft(profile);
    setProfileOpen(true);
  }

  function saveProfile(event) {
    event.preventDefault();

    const name = profileDraft.name.trim();
    const role = profileDraft.role.trim();
    const email = profileDraft.email.trim();

    if (!name || !role || !email) {
      showNotice('Name, role, and email are required.', 'error');
      return;
    }

    const nextProfile = { name, role, email };
    setProfile(nextProfile);
    setProfileDraft(nextProfile);
    window.localStorage.setItem('name-tbd-profile', JSON.stringify(nextProfile));
    setProfileOpen(false);
    showNotice('Profile updated successfully.');
  }

  const initials = profile.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--text-primary)]">
      <div className="relative flex min-h-screen">
        <aside className="hidden w-[260px] shrink-0 border-r border-white/6 bg-[rgba(12,16,32,0.92)] px-5 py-6 xl:block">
          <NavLink to="/" className="flex items-center gap-3 px-2">
            <div className="grid size-11 place-items-center rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(86,87,232,.26),rgba(140,231,255,.12))] shadow-[0_0_40px_rgba(86,87,232,.15)]">
              <ShieldCheck size={20} className="text-[var(--ice-blue)]" />
            </div>
            <div className="min-w-0">
              <div className="wrap-anywhere text-xl font-semibold tracking-tight text-white">NAME TBD</div>
              <div className="wrap-anywhere text-xs text-[var(--text-muted)]">Executive command center</div>
            </div>
          </NavLink>

          <nav className="mt-8 space-y-1.5">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center justify-between rounded-2xl px-3 py-3 text-sm transition ${
                  isActive
                    ? 'bg-[rgba(86,87,232,.18)] text-white shadow-[inset_0_0_0_1px_rgba(140,231,255,.14)]'
                    : 'text-[var(--text-secondary)] hover:bg-white/[0.04] hover:text-white'
                }`
              }
            >
              <span className="flex min-w-0 items-center gap-3">
                <LayoutDashboard size={18} className="shrink-0" />
                <span className="wrap-anywhere">Dashboard</span>
              </span>
            </NavLink>

            {secondaryNavItems.map(({ label, icon: Icon, count }) => (
              <button
                key={label}
                type="button"
                onClick={() => showNotice(`${label} is planned, but no dedicated page is connected yet.`, 'info')}
                className="flex w-full items-center justify-between gap-3 rounded-2xl px-3 py-3 text-left text-sm text-[var(--text-secondary)] transition hover:bg-white/[0.04] hover:text-white"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon size={18} className="shrink-0" />
                  <span className="wrap-anywhere">{label}</span>
                </span>
                {count ? (
                  <span className="shrink-0 rounded-full bg-[rgba(86,87,232,.26)] px-2 py-0.5 text-xs font-semibold text-[var(--ice-blue)]">
                    {count}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="mt-10 rounded-3xl border border-white/8 bg-[var(--surface)]/70 p-4">
            <p className="wrap-anywhere text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">API status</p>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
              <span className="wrap-anywhere text-sm text-[var(--text-secondary)]">Contract mode</span>
              <span className="shrink-0 rounded-full border border-[rgba(140,231,255,.24)] bg-[rgba(140,231,255,.08)] px-2.5 py-1 text-xs font-semibold text-[var(--ice-blue)]">
                {apiMode}
              </span>
            </div>
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b border-white/6 bg-[rgba(12,16,32,0.86)] backdrop-blur-xl">
            <div className="flex items-center gap-4 px-4 py-4 lg:px-8">
              <div className="min-w-0 xl:hidden">
                <div className="wrap-anywhere text-lg font-semibold text-white">NAME TBD</div>
                <div className="wrap-anywhere text-xs text-[var(--text-muted)]">Executive command center</div>
              </div>

              <form onSubmit={handleSearchSubmit} className="relative hidden max-w-xl min-w-0 flex-1 md:block">
                <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  ref={searchRef}
                  type="search"
                  value={searchTerm}
                  onFocus={handleSearchFocus}
                  onChange={(event) => {
                    setSearchTerm(event.target.value);
                    setSearchOpen(true);
                    if (!searchLoaded) ensureSearchCasesLoaded();
                  }}
                  placeholder="Search patients, cases, or keywords..."
                  aria-label="Search cases"
                  className="h-12 w-full rounded-2xl border border-white/8 bg-[var(--surface-elevated)] pl-11 pr-12 text-sm text-white outline-none transition placeholder:text-[var(--text-muted)] focus:border-[rgba(140,231,255,.2)] focus:shadow-[0_0_0_3px_rgba(140,231,255,.08)]"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-white/8 px-2 py-0.5 text-[10px] text-[var(--text-muted)]">/</span>

                {searchOpen ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+10px)] z-50 max-h-80 overflow-y-auto rounded-2xl border border-white/10 bg-[#11162f] p-2 shadow-[0_24px_60px_rgba(0,0,0,.5)]">
                    {searchLoading ? (
                      <div className="px-3 py-4 text-sm text-[var(--text-secondary)]">Loading cases…</div>
                    ) : filteredSearchCases.length ? (
                      filteredSearchCases.map((item) => (
                        <button
                          type="button"
                          key={item.case_id}
                          onClick={() => selectSearchResult(item)}
                          className="flex w-full min-w-0 items-start justify-between gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/[0.05]"
                        >
                          <div className="min-w-0">
                            <div className="wrap-anywhere text-sm font-semibold text-white">{item.patient.patient_id} · {item.patient.name}</div>
                            <div className="wrap-anywhere mt-1 text-xs text-[var(--text-secondary)]">{item.issue} · {item.status?.replaceAll('_', ' ') || 'UNKNOWN'}</div>
                          </div>
                          <span className="shrink-0 text-xs text-[var(--ice-blue)]">{item.risk.level}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-4 text-sm text-[var(--text-secondary)]">No matching cases.</div>
                    )}
                  </div>
                ) : null}
              </form>

              <div className="ml-auto flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  disabled={headerBusy}
                  onClick={handleHeaderRunAgent}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[rgba(140,231,255,.14)] bg-[linear-gradient(180deg,rgba(86,87,232,.95),rgba(74,75,201,.92))] px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(86,87,232,.28)] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
                >
                  <Play size={16} className="fill-current" />
                  <span className="hidden sm:inline">{headerBusy ? 'Starting…' : 'Run Agent'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => showNotice('No new notifications.', 'info')}
                  aria-label="Notifications"
                  className="grid size-11 place-items-center rounded-2xl border border-white/8 bg-[var(--surface-elevated)] text-[var(--text-secondary)] transition hover:text-white"
                >
                  <Bell size={17} />
                </button>

                <button
                  type="button"
                  onClick={openProfile}
                  aria-label="Edit user profile"
                  className="flex h-11 min-w-0 items-center gap-3 rounded-2xl border border-white/8 bg-[var(--surface-elevated)] px-3.5 text-left transition hover:bg-white/[0.05]"
                >
                  <div className="grid size-8 shrink-0 place-items-center rounded-full bg-[rgba(140,231,255,.16)] text-xs font-semibold text-[var(--ice-blue)]">{initials}</div>
                  <div className="hidden min-w-0 md:block">
                    <div className="wrap-anywhere max-w-40 text-sm font-medium text-white">{profile.name}</div>
                    <div className="wrap-anywhere max-w-40 text-[11px] text-[var(--text-muted)]">{profile.role}</div>
                  </div>
                  <ChevronDown size={15} className="hidden shrink-0 text-[var(--text-muted)] md:block" />
                </button>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8" onClick={() => searchOpen && setSearchOpen(false)}>
            <Outlet />
          </main>
        </div>
      </div>

      {notice ? (
        <div
          role="status"
          className={`fixed right-5 top-20 z-[80] max-w-[min(420px,calc(100vw-2.5rem))] rounded-2xl border px-4 py-3 text-sm shadow-[0_20px_60px_rgba(0,0,0,.5)] backdrop-blur-xl ${
            notice.type === 'error'
              ? 'border-[#ff8ea6]/25 bg-[#351d2a]/95 text-[#ffd1da]'
              : notice.type === 'info'
                ? 'border-[rgba(140,231,255,.22)] bg-[#13243a]/95 text-[#c8f5ff]'
                : 'border-[#77e9b2]/24 bg-[#133227]/95 text-[#c9ffe2]'
          }`}
        >
          <div className="wrap-anywhere">{notice.message}</div>
        </div>
      ) : null}

      {profileOpen ? (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setProfileOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="profile-modal-title" className="surface-card w-full max-w-lg rounded-[30px] p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">User profile</p>
                <h2 id="profile-modal-title" className="wrap-anywhere mt-1 text-2xl font-semibold text-white">Edit operator profile</h2>
                <p className="wrap-anywhere mt-2 text-sm leading-6 text-[var(--text-secondary)]">This is a local demo profile. It does not represent production authentication.</p>
              </div>
              <button type="button" onClick={() => setProfileOpen(false)} aria-label="Close profile editor" className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/8 bg-white/[0.03] text-[var(--text-secondary)] hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={saveProfile} className="mt-6 space-y-4">
              <ProfileField label="Name" value={profileDraft.name} onChange={(value) => setProfileDraft((current) => ({ ...current, name: value }))} />
              <ProfileField label="Role" value={profileDraft.role} onChange={(value) => setProfileDraft((current) => ({ ...current, role: value }))} />
              <ProfileField label="Email" type="email" value={profileDraft.email} onChange={(value) => setProfileDraft((current) => ({ ...current, email: value }))} />

              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <button type="button" onClick={() => setProfileOpen(false)} className="rounded-2xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] transition hover:bg-white/[0.05] hover:text-white">Cancel</button>
                <button type="submit" className="rounded-2xl bg-[linear-gradient(180deg,var(--brand),#4849c8)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(86,87,232,.24)]">Save Profile</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProfileField({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.035] px-4 text-sm text-white outline-none transition focus:border-[rgba(140,231,255,.3)] focus:shadow-[0_0_0_3px_rgba(140,231,255,.08)]"
      />
    </label>
  );
}
