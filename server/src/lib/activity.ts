import { supabase } from './supabase';
import { logger } from './logger';

interface ActivityInput {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

// Journalisation best-effort : une erreur de log ne doit jamais faire échouer l'action métier.
export const logActivity = async ({ actorId, action, entityType, entityId, metadata }: ActivityInput): Promise<void> => {
  try {
    const { error } = await supabase.rpc('log_activity', {
      p_actor_id: actorId ?? null,
      p_action: action,
      p_entity_type: entityType ?? null,
      p_entity_id: entityId ?? null,
      p_metadata: metadata ?? {},
    });
    if (error) logger.warn("Journalisation d'activité échouée", { error: error.message, action });
  } catch (err) {
    logger.warn("Journalisation d'activité échouée", { error: err instanceof Error ? err.message : String(err), action });
  }
};
