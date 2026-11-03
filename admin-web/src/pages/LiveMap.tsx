import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import AssignPanel, { type AssignTarget } from '../components/AssignPanel';
import { ErrorState, LoadingBlock, PageHeader, StatStrip } from '../components/ui';
import { ClockIcon, DocumentIcon, MapIcon, ToolIcon, UsersIcon } from '../components/icons';
import { supabase } from '../lib/supabase';

interface PersonPoint {
  user_id: string;
  latitude: number;
  longitude: number;
  updated_at: string;
  profile: {
    full_name: string | null;
    role: string | null;
    phone: string | null;
    profession: string | null;
    is_available: boolean | null;
  } | null;
}

interface QuotePoint {
  id: string;
  client_id: string;
  description: string | null;
  status: string;
  latitude: number;
  longitude: number;
  created_at: string;
  client: { full_name: string | null } | null;
  artisan: { full_name: string | null } | null;
}

type Selection =
  | { kind: 'person'; point: PersonPoint }
  | { kind: 'quote'; point: QuotePoint };

const STALE_MS = 10 * 60 * 1000;

const COLORS = {
  artisan: '#16a34a',
  artisanOff: '#9ca3af',
  client: '#2563eb',
  unassigned: '#ea580c',
  assigned: '#7c3aed',
};

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
}

/** Cadre la carte sur tous les points, une seule fois (au premier chargement). */
function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 14 });
  }, [map, points]);
  return null;
}

export default function LiveMap() {
  const [people, setPeople] = useState<PersonPoint[]>([]);
  const [quotes, setQuotes] = useState<QuotePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    const [locRes, quoteRes] = await Promise.all([
      supabase.from('user_locations').select('user_id, latitude, longitude, updated_at').limit(1000),
      supabase
        .from('quotes')
        .select('id, client_id, artisan_id, description, status, latitude, longitude, created_at')
        .in('status', ['unassigned', 'assigned', 'pending', 'accepted'])
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .limit(500),
    ]);
    if (locRes.error) throw new Error(locRes.error.message);
    if (quoteRes.error) throw new Error(quoteRes.error.message);

    const locs = locRes.data ?? [];
    const rawQuotes = quoteRes.data ?? [];

    // Requête séparée plutôt qu'un embed PostgREST : ne dépend pas du nom des clés étrangères.
    const ids = Array.from(
      new Set([
        ...locs.map((l) => l.user_id as string),
        ...rawQuotes.flatMap((q) => [q.client_id as string, q.artisan_id as string | null]),
      ].filter((id): id is string => Boolean(id)))
    );
    const profRes = ids.length
      ? await supabase
          .from('profiles')
          .select('id, full_name, role, phone, profession, is_available')
          .in('id', ids)
      : { data: [], error: null };
    if (profRes.error) throw new Error(profRes.error.message);
    const byId = new Map((profRes.data ?? []).map((p) => [p.id as string, p]));

    setPeople(
      locs.map((l) => ({
        ...(l as Omit<PersonPoint, 'profile'>),
        profile: (byId.get(l.user_id as string) as PersonPoint['profile']) ?? null,
      }))
    );
    setQuotes(
      rawQuotes.map((q) => ({
        ...(q as Omit<QuotePoint, 'client' | 'artisan'>),
        client: byId.get(q.client_id as string) ?? null,
        artisan: q.artisan_id ? (byId.get(q.artisan_id as string) ?? null) : null,
      })) as QuotePoint[]
    );
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    load()
      .catch((err) => active && setError(err instanceof Error ? err.message : 'Chargement impossible.'))
      .finally(() => active && setLoading(false));

    // Rafraîchissement groupé : plusieurs changements rapprochés = un seul rechargement.
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        load().catch((err) => console.warn('[carte] rafraîchissement:', err));
      }, 400);
    };

    const channel = supabase
      .channel('admin-live-map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_locations' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes' }, refresh)
      .subscribe((status) => active && setLive(status === 'SUBSCRIBED'));

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const bounds = useMemo<[number, number][]>(
    () => [
      ...people.map((p) => [p.latitude, p.longitude] as [number, number]),
      ...quotes.map((q) => [q.latitude, q.longitude] as [number, number]),
    ],
    [people, quotes]
  );

  const artisans = people.filter((p) => p.profile?.role === 'artisan');
  const clients = people.filter((p) => p.profile?.role === 'client');
  const toAssign = quotes.filter((q) => q.status === 'unassigned');

  const selectPerson = (point: PersonPoint) => {
    setSelection({ kind: 'person', point });
    setAssignTarget(
      point.profile?.role === 'artisan'
        ? { kind: 'artisan', id: point.user_id, label: point.profile.full_name ?? 'Artisan' }
        : null
    );
  };

  const selectQuote = (point: QuotePoint) => {
    setSelection({ kind: 'quote', point });
    setAssignTarget({
      kind: 'quote',
      id: point.id,
      label: `${point.client?.full_name ?? 'Client'} — ${point.description ?? 'Sans description'}`,
    });
  };

  const afterAssign = () => {
    setSelection(null);
    setAssignTarget(null);
    void load();
  };

  if (loading) return <LoadingBlock label="Chargement de la carte…" />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  const clientQuotes =
    selection?.kind === 'person' && selection.point.profile?.role === 'client'
      ? quotes.filter((q) => q.client_id === selection.point.user_id && q.status === 'unassigned')
      : [];

  return (
    <div>
      <PageHeader
        title="Carte en direct"
        subtitle="Position GPS des clients et des artisans, mise à jour en temps réel"
        icon={<MapIcon className="h-6 w-6" />}
        actions={
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset ${
              live ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-gray-100 text-gray-600 ring-gray-200'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-emerald-500' : 'bg-gray-400'}`} />
            {live ? 'En direct' : 'Connexion…'}
          </span>
        }
      />

      <StatStrip
        tiles={[
          { label: 'Artisans en ligne', value: artisans.length, icon: <ToolIcon className="h-5 w-5" />, tone: 'green' },
          { label: 'Clients en ligne', value: clients.length, icon: <UsersIcon className="h-5 w-5" />, tone: 'sky' },
          { label: 'Devis à assigner', value: toAssign.length, icon: <DocumentIcon className="h-5 w-5" />, tone: 'amber' },
          { label: 'Devis en cours', value: quotes.length - toAssign.length, icon: <ClockIcon className="h-5 w-5" />, tone: 'violet' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="h-[calc(100vh-20rem)] min-h-[420px] overflow-hidden rounded-2xl border border-gray-100 shadow-lg ring-4 ring-white">
          <MapContainer center={[20, 0]} zoom={2} className="h-full w-full" scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitOnce points={bounds} />

            {people.map((p) => {
              const isArtisan = p.profile?.role === 'artisan';
              const stale = Date.now() - new Date(p.updated_at).getTime() > STALE_MS;
              const color = isArtisan
                ? p.profile?.is_available === false
                  ? COLORS.artisanOff
                  : COLORS.artisan
                : COLORS.client;
              return (
                <CircleMarker
                  key={p.user_id}
                  center={[p.latitude, p.longitude]}
                  radius={8}
                  pathOptions={{ color: '#fff', weight: 2, fillColor: color, fillOpacity: stale ? 0.45 : 0.95 }}
                  eventHandlers={{ click: () => selectPerson(p) }}
                >
                  <Tooltip>
                    {p.profile?.full_name ?? 'Utilisateur'} ({isArtisan ? 'artisan' : 'client'}) ·{' '}
                    {timeAgo(p.updated_at)}
                  </Tooltip>
                </CircleMarker>
              );
            })}

            {quotes.map((q) => (
              <CircleMarker
                key={q.id}
                center={[q.latitude, q.longitude]}
                radius={11}
                pathOptions={{
                  color: q.status === 'unassigned' ? COLORS.unassigned : COLORS.assigned,
                  weight: 3,
                  fillColor: q.status === 'unassigned' ? COLORS.unassigned : COLORS.assigned,
                  fillOpacity: 0.25,
                }}
                eventHandlers={{ click: () => selectQuote(q) }}
              >
                <Tooltip>
                  Devis · {q.client?.full_name ?? 'Client'} · {q.status === 'unassigned' ? 'à assigner' : 'assigné'}
                </Tooltip>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-100 bg-white p-4 text-sm shadow-sm">
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Légende</p>
            <Legend color={COLORS.artisan} label={`Artisans disponibles (${artisans.filter((a) => a.profile?.is_available !== false)            .length})`} />
            <Legend color={COLORS.artisanOff} label="Artisans indisponibles" />
            <Legend color={COLORS.client} label={`Clients (${clients.length})`} />
            <Legend color={COLORS.unassigned} ring label={`Devis à assigner (${toAssign.length})`} />
            <Legend color={COLORS.assigned} ring label="Devis assignés / en cours" />
            <p className="mt-2 text-xs text-muted">Points estompés : position non mise à jour depuis plus de 10 min.</p>
          </div>

          {selection ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-4 text-sm shadow-sm">
              {selection.kind === 'person' ? (
                <>
                  <p className="font-semibold text-ink">{selection.point.profile?.full_name ?? 'Utilisateur'}</p>
                  <p className="text-muted">
                    {selection.point.profile?.role === 'artisan' ? 'Artisan' : 'Client'}
                    {selection.point.profile?.profession ? ` · ${selection.point.profile.profession}` : ''}
                  </p>
                  {selection.point.profile?.phone ? <p className="text-muted">{selection.point.profile.phone}</p> : null}
                  <p className="mt-1 text-xs text-muted">Position {timeAgo(selection.point.updated_at)}</p>
                  {selection.point.profile?.role === 'client' ? (
                    clientQuotes.length === 0 ? (
                      <p className="mt-3 text-xs text-muted">Aucun devis à assigner pour ce client.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {clientQuotes.map((q) => (
                          <button
                            key={q.id}
                            type="button"
                            onClick={() => selectQuote(q)}
                            className="block w-full rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-left text-xs text-orange-800 hover:bg-orange-100"
                          >
                            Assigner : {q.description ?? 'Sans description'}
                          </button>
                        ))}
                      </div>
                    )
                  ) : null}
                </>
              ) : (
                <>
                  <p className="font-semibold text-ink">Devis de {selection.point.client?.full_name ?? 'Client'}</p>
                  <p className="text-muted">{selection.point.description ?? 'Sans description'}</p>
                  {selection.point.artisan?.full_name ? (
                    <p className="mt-1 text-xs text-muted">Assigné à {selection.point.artisan.full_name}</p>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm text-muted">
              Cliquez sur un point de la carte : un devis pour l'assigner à l'artisan le plus proche, un artisan
              pour lui attribuer un devis proche.
            </p>
          )}

          {assignTarget ? (
            <AssignPanel
              key={`${assignTarget.kind}:${assignTarget.id}`}
              target={assignTarget}
              onAssigned={afterAssign}
              onClose={() => setAssignTarget(null)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label, ring }: { color: string; label: string; ring?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span
        className="inline-block h-3.5 w-3.5 rounded-full"
        style={ring ? { border: `3px solid ${color}`, background: `${color}40` } : { background: color }}
      />
      <span className="text-ink">{label}</span>
    </div>
  );
}
