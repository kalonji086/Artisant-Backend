import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import DecisionModal from '../components/DecisionModal';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import {
  BriefcaseIcon,
  CheckIcon,
  CloseIcon,
  DocumentIcon,
  InboxIcon,
  ToolIcon,
  TrendIcon,
  UsersIcon,
} from '../components/icons';
import { EmptyState, ErrorState, LoadingBlock, PageHeader, Spinner } from '../components/ui';
import { AdminService, apiErrorMessage } from '../lib/api';
import type { AdminStats, EmployerRequest } from '../types';
import { formatDate, formatNumber, initials, monthLabel } from '../utils/format';

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  accepted: '#10b981',
  rejected: '#f43f5e',
  completed: '#0ea5e9',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  accepted: 'Acceptés',
  rejected: 'Rejetés',
  completed: 'Terminés',
};

interface DecisionTarget {
  request: EmployerRequest;
  tone: 'approve' | 'reject';
}

type Flash = { tone: 'ok' | 'error'; message: string } | null;

export default function Dashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [pendingRequests, setPendingRequests] = useState<EmployerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionTarget | null>(null);
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, requestsRes] = await Promise.all([
        AdminService.getStats(),
        AdminService.getEmployerRequests({ status: 'pending', pageSize: 5 }),
      ]);
      setStats(statsRes.data);
      setPendingRequests(requestsRes.data.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger les statistiques.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(timer);
  }, [flash]);

  const confirmDecision = async (notes: string) => {
    if (!decision) return;
    setDecisionLoading(true);
    setDecisionError(null);
    try {
      const approved = decision.tone === 'approve';
      await AdminService.updateEmployerRequest(decision.request.id, {
        status: approved ? 'approved' : 'rejected',
        ...(notes ? { admin_notes: notes } : {}),
      });
      setFlash({
        tone: 'ok',
        message: approved
          ? `Demande de « ${decision.request.company_name} » approuvée — profil employeur activé.`
          : `Demande de « ${decision.request.company_name} » rejetée.`,
      });
      setDecisionError(null);
      setDecision(null);
      await load();
    } catch (err) {
      setDecisionError(apiErrorMessage(err, 'Mise à jour impossible.'));
    } finally {
      setDecisionLoading(false);
    }
  };

  const renderContent = (): ReactNode => {
    if (loading) return <LoadingBlock label="Chargement du tableau de bord…" />;
    if (error) return <ErrorState message={error} onRetry={() => void load()} />;
    if (!stats) return <EmptyState title="Aucune statistique disponible" />;

    const { totals } = stats;
    const quotesTotal = stats.quotesByStatus.reduce((sum, s) => sum + s.count, 0);

    return (
      <div className="space-y-6">
        {flash ? (
          <div
            role="status"
            className={[
              'rounded-xl px-4 py-3 text-sm font-medium',
              flash.tone === 'ok'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border border-rose-200 bg-rose-50 text-rose-800',
            ].join(' ')}
          >
            {flash.message}
          </div>
        ) : null}

        {/* KPIs */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            label="Utilisateurs"
            value={formatNumber(totals.users)}
            hint={`${formatNumber(totals.clients)} clients · ${formatNumber(totals.artisans)} artisans`}
            icon={<UsersIcon className="h-6 w-6" />}
            tone="brand"
          />
          <StatCard
            label="Artisans disponibles"
            value={formatNumber(totals.activeArtisans)}
            hint={`sur ${formatNumber(totals.artisans)} artisans inscrits`}
            icon={<ToolIcon className="h-6 w-6" />}
            tone="green"
          />
          <StatCard
            label="Clients"
            value={formatNumber(totals.clients)}
            hint="Comptes côté demande"
            icon={<TrendIcon className="h-6 w-6" />}
            tone="cyan"
          />
          <StatCard
            label="Devis en attente"
            value={formatNumber(totals.quotesPending)}
            hint={`${formatNumber(totals.quotes)} devis au total`}
            icon={<DocumentIcon className="h-6 w-6" />}
            tone="amber"
          />
          <StatCard
            label="Offres d'emploi"
            value={formatNumber(totals.jobs)}
            hint={`${formatNumber(totals.categories)} catégories de services`}
            icon={<BriefcaseIcon className="h-6 w-6" />}
            tone="violet"
          />
          <StatCard
            label="Demandes employeur"
            value={formatNumber(totals.employerRequestsPending)}
            hint="En attente de validation"
            icon={<InboxIcon className="h-6 w-6" />}
            tone="rose"
          />
        </div>
        {/* Graphiques */}
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-ink">Devis par statut</h3>
            {quotesTotal === 0 ? (
              <div className="flex h-56 items-center justify-center text-sm text-muted">
                Aucun devis enregistré
              </div>
            ) : (
              <>
                <div className="mt-3 h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={stats.quotesByStatus}
                        dataKey="count"
                        nameKey="status"
                        innerRadius={52}
                        outerRadius={80}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {stats.quotesByStatus.map((entry) => (
                          <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatNumber(Number(value))} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {stats.quotesByStatus.map((entry) => (
                    <li key={entry.status} className="flex items-center gap-2 text-xs text-muted">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: STATUS_COLORS[entry.status] ?? '#94a3b8' }}
                      />
                      <span className="truncate">{STATUS_LABELS[entry.status] ?? entry.status}</span>
                      <span className="ml-auto font-semibold text-ink">{entry.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-ink">Inscriptions — 6 derniers mois</h3>
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.signupsByMonth} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f6" />
                  <XAxis
                    dataKey="month"
                    tickFormatter={monthLabel}
                    tick={{ fontSize: 12, fill: '#60646c' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: '#60646c' }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    cursor={{ fill: '#f8fafc' }}
                    formatter={(value) => [formatNumber(Number(value)), 'Inscriptions']}
                    labelFormatter={(label) => monthLabel(String(label))}
                  />
                  <Bar dataKey="count" fill="#208aef" radius={[6, 6, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-ink">Services par catégorie</h3>
            {stats.servicesByCategory.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted">
                Aucun service déclaré
              </div>
            ) : (
              <div className="mt-3 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={stats.servicesByCategory}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2f6" />
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="category"
                      tick={{ fontSize: 12, fill: '#60646c' }}
                      axisLine={false}
                      tickLine={false}
                      width={110}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      formatter={(value) => [formatNumber(Number(value)), 'Services']}
                    />
                    <Bar dataKey="count" fill="#10b981" radius={[0, 6, 6, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
        {/* Activité récente */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-ink">Derniers devis</h3>
            {stats.recentQuotes.length === 0 ? (
              <p className="mt-4 text-sm text-muted">Aucun devis récent.</p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100">
                {stats.recentQuotes.map((quote) => (
                  <li key={quote.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {quote.client_name} <span className="text-muted">→</span> {quote.artisan_name}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {formatDate(quote.created_at)}
                        {quote.description ? ` · ${quote.description}` : ''}
                      </p>
                    </div>
                    <StatusBadge value={quote.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-ink">Nouveaux utilisateurs</h3>
            {stats.recentUsers.length === 0 ? (
              <p className="mt-4 text-sm text-muted">Aucune inscription récente.</p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100">
                {stats.recentUsers.map((user) => (
                  <li key={user.id} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-bold text-brand-dark">
                      {initials(user.full_name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {user.full_name ?? 'Sans nom'}
                      </p>
                      <p className="text-xs text-muted">Inscrit le {formatDate(user.created_at)}</p>
                    </div>
                    <StatusBadge value={user.role ?? 'client'} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Demandes employeur en attente */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">Demandes employeur à traiter</h3>
              <p className="text-xs text-muted">
                {pendingRequests.length} demande{pendingRequests.length > 1 ? 's' : ''} en attente
                affichée{pendingRequests.length > 1 ? 's' : ''}
              </p>
            </div>
            <NavLink
              to="/demandes-employeur"
              className="text-sm font-medium text-brand hover:text-brand-dark hover:underline"
            >
              Tout voir →
            </NavLink>
          </div>

          {pendingRequests.length === 0 ? (
            <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              Aucune demande employeur en attente — tout est à jour. 🎉
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {pendingRequests.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-4 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{request.company_name}</p>
                    <p className="truncate text-xs text-muted">
                      {request.industry} · contact : {request.contact_person} ·{' '}
                      {formatDate(request.created_at)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDecisionError(null);
                        setDecision({ request, tone: 'approve' });
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
                    >
                      <CheckIcon className="h-4 w-4" />
                      Approuver
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDecisionError(null);
                        setDecision({ request, tone: 'reject' });
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
                    >
                      <CloseIcon className="h-4 w-4" />
                      Rejeter
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Tableau de bord"
        subtitle="Vue d'ensemble de la plateforme ARTISANTS"
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? <Spinner className="h-4 w-4 text-brand" /> : null}
            Actualiser
          </button>
        }
      />

      {renderContent()}

      <DecisionModal
        open={decision !== null}
        tone={decision?.tone ?? 'approve'}
        title={decision?.tone === 'approve' ? 'Approuver la demande ?' : 'Rejeter la demande ?'}
        subtitle={
          decision ? `${decision.request.company_name} — ${decision.request.industry}` : undefined
        }
        error={decisionError}
        confirmLabel={decision?.tone === 'approve' ? 'Approuver' : 'Rejeter'}
        loading={decisionLoading}
        onClose={() => {
          setDecision(null);
          setDecisionError(null);
        }}
        onConfirm={(notes) => void confirmDecision(notes)}
      />
    </div>
  );
}
