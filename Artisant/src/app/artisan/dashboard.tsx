import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, Button, Switch } from 'react-native-paper';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { StatCard } from '@/components/StatCard';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

type DashboardStats = {
  quoteCount: number;
  pendingQuoteCount: number;
  serviceCount: number;
  rating: number | null;
  isAvailable: boolean;
};

const getExactCount = (label: string, count: number | null) => {
  if (count === null) {
    throw new Error(`Impossible de récupérer le nombre de ${label}.`);
  }

  return count;
};

export default function ArtisanDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const userId = user?.id;
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingAvailability, setUpdatingAvailability] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const initialLoad = useRef(true);

  const loadDashboard = useCallback(async () => {
    if (!userId) {
      setStats(null);
      setError('Connectez-vous pour consulter votre tableau de bord.');
      setLoading(false);
      return;
    }

    if (initialLoad.current) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [profileResult, quotesResult, pendingQuotesResult, servicesResult] =
        await Promise.all([
          supabase
            .from('profiles')
            .select('is_available, rating')
            .eq('id', userId)
            .maybeSingle(),
          supabase
            .from('quotes')
            .select('id', { count: 'exact', head: true })
            .eq('artisan_id', userId),
          supabase
            .from('quotes')
            .select('id', { count: 'exact', head: true })
            .eq('artisan_id', userId)
            .eq('status', 'pending'),
          supabase
            .from('artisan_services')
            .select('id', { count: 'exact', head: true })
            .eq('artisan_id', userId),
        ]);

      if (profileResult.error) throw profileResult.error;
      if (quotesResult.error) throw quotesResult.error;
      if (pendingQuotesResult.error) throw pendingQuotesResult.error;
      if (servicesResult.error) throw servicesResult.error;
      if (!profileResult.data) {
        throw new Error('Votre profil artisan est introuvable.');
      }

      setStats({
        quoteCount: getExactCount('devis', quotesResult.count),
        pendingQuoteCount: getExactCount('devis en attente', pendingQuotesResult.count),
        serviceCount: getExactCount('services', servicesResult.count),
        rating:
          profileResult.data.rating === null
            ? null
            : Number(profileResult.data.rating),
        isAvailable: profileResult.data.is_available ?? false,
      });
      setError(null);
    } catch (loadError: unknown) {
      console.error('Erreur lors du chargement du tableau de bord artisan:', loadError);
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Impossible de récupérer les statistiques. Réessayez.'
      );
    } finally {
      initialLoad.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    initialLoad.current = true;
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!userId) return;

    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshFromRealtime = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void loadDashboard();
      }, 300);
    };

    const channel = supabase
      .channel(`artisan-dashboard:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quotes',
          filter: `artisan_id=eq.${userId}`,
        },
        refreshFromRealtime
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        refreshFromRealtime
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'artisan_services',
          filter: `artisan_id=eq.${userId}`,
        },
        refreshFromRealtime
      )
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      setRealtimeConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [loadDashboard, userId]);

  const updateAvailability = async (isAvailable: boolean) => {
    if (!userId || updatingAvailability) return;

    setUpdatingAvailability(true);
    try {
      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({ is_available: isAvailable })
        .eq('id', userId)
        .select('is_available')
        .single();

      if (updateError) throw updateError;

      setStats((current) =>
        current ? { ...current, isAvailable: data.is_available ?? false } : current
      );
    } catch (updateError: unknown) {
      console.error('Erreur lors de la mise à jour de la disponibilité:', updateError);
      Alert.alert(
        'Disponibilité non modifiée',
        updateError instanceof Error
          ? updateError.message
          : 'Impossible d’enregistrer votre disponibilité. Réessayez.'
      );
    } finally {
      setUpdatingAvailability(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadDashboard()}
              tintColor="#208AEF"
            />
          }
        >
          <View style={styles.header}>
            <ThemedText type="title">Tableau de bord</ThemedText>
            <ThemedText>Suivez votre activité et vos demandes de devis.</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {realtimeConnected
                ? '● Données mises à jour en temps réel'
                : '○ Actualisation manuelle disponible'}
            </ThemedText>
          </View>

          <ThemedView type="backgroundElement" style={styles.statusBox}>
            <View style={styles.availabilityText}>
              <ThemedText type="subtitle">Disponibilité</ThemedText>
              <ThemedText type="small">
                {stats?.isAvailable
                  ? 'Votre profil est visible par les clients'
                  : 'Votre profil est masqué des recherches'}
              </ThemedText>
            </View>
            {updatingAvailability ? (
              <ActivityIndicator size="small" color="#208AEF" />
            ) : (
              <Switch
                value={stats?.isAvailable ?? false}
                onValueChange={(value) => void updateAvailability(value)}
                color="#208AEF"
                disabled={!stats || loading}
                accessibilityLabel="Modifier la disponibilité"
              />
            )}
          </ThemedView>

          {loading && !stats ? (
            <ActivityIndicator style={styles.loader} size="large" color="#208AEF" />
          ) : error && !stats ? (
            <View style={styles.errorBox}>
              <ThemedText>{error}</ThemedText>
              <Button mode="contained" onPress={() => void loadDashboard()}>
                Réessayer
              </Button>
            </View>
          ) : (
            <>
              {error ? (
                <ThemedText type="small" style={styles.refreshError}>
                  {error} Tirez vers le bas pour réessayer.
                </ThemedText>
              ) : null}

              <View style={styles.statsGrid}>
                <View style={styles.row}>
                  <StatCard
                    title="Devis reçus"
                    value={stats?.quoteCount ?? '—'}
                    icon="file-document-edit"
                    color="#4CAF50"
                  />
                  <StatCard
                    title="En attente"
                    value={stats?.pendingQuoteCount ?? '—'}
                    icon="clock-outline"
                    color="#FF9800"
                  />
                </View>
                <View style={styles.row}>
                  <StatCard
                    title="Services"
                    value={stats?.serviceCount ?? '—'}
                    icon="briefcase-outline"
                    color="#208AEF"
                  />
                  <StatCard
                    title="Note du profil"
                    value={
                      stats?.rating !== null && stats?.rating !== undefined &&
                      Number.isFinite(stats.rating)
                        ? `${stats.rating.toFixed(1)}/5`
                        : '—'
                    }
                    icon="star"
                    color="#D9A400"
                  />
                </View>
              </View>
            </>
          )}

          <Button
            mode="outlined"
            onPress={() => router.back()}
            style={styles.backButton}
          >
            Retour au profil
          </Button>

          <View style={styles.bottomInset} />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    padding: Spacing.four,
    gap: Spacing.one,
  },
  statusBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: Spacing.four,
    padding: Spacing.four,
    borderRadius: Spacing.three,
    marginBottom: Spacing.three,
  },
  availabilityText: {
    flex: 1,
    marginRight: Spacing.two,
  },
  statsGrid: {
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.three,
  },
  row: {
    flexDirection: 'row',
  },
  loader: {
    marginVertical: Spacing.six,
  },
  errorBox: {
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    padding: Spacing.four,
  },
  refreshError: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
  },
  backButton: {
    margin: Spacing.four,
  },
  bottomInset: {
    height: BottomTabInset + Spacing.four,
  },
});
