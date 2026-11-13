import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { createPresentation, extractPresentationImages, type PresentationMedia } from '../lib/artisan-presentation';

const BUCKET = 'artisan-projects';
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_GENERATED_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_GENERATED_IMAGE_BYTES = 45 * 1024 * 1024;

type AuthenticatedRequest = Request & { user?: { id: string } };

const projectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(3000),
  source_path: z.string().min(1).max(300),
});

const getArtisanId = (req: Request) => (req as AuthenticatedRequest).user?.id;

const requireArtisan = async (userId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> => {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    logger.error('Impossible de vérifier le rôle pour le portfolio', { userId, error: error.message });
    return { ok: false, status: 500, error: 'Impossible de vérifier le profil artisan.' };
  }
  if (profile?.role !== 'artisan') {
    return { ok: false, status: 403, error: 'Cette fonctionnalité est réservée aux artisans.' };
  }
  return { ok: true };
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Erreur inconnue pendant le traitement du portfolio.';

export const importPortfolioPresentation = async (req: Request, res: Response) => {
  const userId = getArtisanId(req);
  if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifié.' });

  const validation = projectSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Données invalides.',
      details: validation.error.errors.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const permission = await requireArtisan(userId);
  if (!permission.ok) return res.status(permission.status).json({ error: permission.error });

  const sourceParts = validation.data.source_path.split('/');
  if (
    sourceParts.length !== 2 ||
    sourceParts[0] !== userId ||
    !/^[A-Za-z0-9._-]+\.pptx$/i.test(sourceParts[1])
  ) {
    return res.status(400).json({ error: 'Chemin du fichier PowerPoint invalide.' });
  }

  const { data: source, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(validation.data.source_path);
  if (downloadError || !source) {
    logger.warn('PowerPoint introuvable pendant l’import', { userId, error: downloadError?.message });
    return res.status(400).json({ error: 'Le fichier PowerPoint n’a pas pu être chargé.' });
  }

  if (source.size > MAX_SOURCE_BYTES) {
    return res.status(413).json({ error: 'Le fichier PowerPoint dépasse 20 Mo.' });
  }

  const sourceBuffer = Buffer.from(await source.arrayBuffer());
  let slideImages;
  try {
    slideImages = extractPresentationImages(sourceBuffer);
  } catch (error) {
    return res.status(422).json({ error: errorMessage(error) });
  }

  const projectId = randomUUID();
  const { data: project, error: insertError } = await supabase
    .from('artisan_projects')
    .insert({
      id: projectId,
      artisan_id: userId,
      title: validation.data.title,
      description: validation.data.description,
      pptx_path: validation.data.source_path,
      status: 'draft',
    })
    .select('id, artisan_id, title, description, pptx_path, like_count, comment_count, created_at, status')
    .single();

  if (insertError || !project) {
    logger.error('Création de la réalisation importée impossible', { userId, error: insertError?.message });
    return res.status(500).json({ error: 'La réalisation n’a pas pu être enregistrée.' });
  }

  const uploadedPaths: string[] = [];
  try {
    const mediaRows = [];
    for (const [position, image] of slideImages.entries()) {
      const storagePath = `${userId}/${projectId}/slide-${position + 1}.${image.extension}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, image.data, {
          contentType: image.extension === 'png' ? 'image/png' : 'image/jpeg',
          upsert: false,
        });
      if (uploadError) throw uploadError;
      uploadedPaths.push(storagePath);
      mediaRows.push({
        project_id: projectId,
        storage_path: storagePath,
        caption: image.caption || validation.data.description,
        position,
      });
    }

    const { error: mediaError } = await supabase.from('artisan_project_media').insert(mediaRows);
    if (mediaError) throw mediaError;

    const { error: publishError } = await supabase.rpc('publish_artisan_project_for_user', {
      p_artisan_id: userId,
      p_project_id: projectId,
    });
    if (publishError) throw publishError;
  } catch (error) {
    const { error: cleanupError } = uploadedPaths.length
      ? await supabase.storage.from(BUCKET).remove(uploadedPaths)
      : { error: null };
    const { error: deleteError } = await supabase.from('artisan_projects').delete().eq('id', projectId);
    if (cleanupError || deleteError) {
      logger.error('Nettoyage incomplet après échec d’import PowerPoint', {
        projectId,
        storageError: cleanupError?.message,
        databaseError: deleteError?.message,
      });
    }
    logger.error('Import du PowerPoint impossible', { projectId, error: errorMessage(error) });
    if (errorMessage(error).includes('PORTFOLIO_ALREADY_CREATED')) {
      return res.status(409).json({ error: 'Un seul portfolio peut être publié par artisan.' });
    }
    return res.status(500).json({ error: 'Les diapositives n’ont pas pu être importées.' });
  }

  const { data: publishedProject, error: publishedProjectError } = await supabase
    .from('artisan_projects')
    .select('id, artisan_id, title, description, pptx_path, like_count, comment_count, created_at, status')
    .eq('id', projectId)
    .single();
  if (publishedProjectError || !publishedProject) {
    logger.error('Lecture de la réalisation importée impossible', {
      projectId,
      error: publishedProjectError?.message,
    });
    return res.status(500).json({ error: 'La réalisation a été importée, mais ne peut pas être chargée.' });
  }

  return res.status(201).json({
    project: publishedProject,
    media: slideImages.length,
    pptxUrl: supabase.storage.from(BUCKET).getPublicUrl(project.pptx_path).data.publicUrl,
  });
};

export const generatePortfolioPresentation = async (req: Request, res: Response) => {
  const userId = getArtisanId(req);
  if (!userId) return res.status(401).json({ error: 'Utilisateur non authentifié.' });

  const idResult = z.string().uuid().safeParse(req.params.id);
  if (!idResult.success) return res.status(400).json({ error: 'Identifiant de réalisation invalide.' });

  const permission = await requireArtisan(userId);
  if (!permission.ok) return res.status(permission.status).json({ error: permission.error });

  const { data: project, error: projectError } = await supabase
    .from('artisan_projects')
    .select('id, artisan_id, title, description')
    .eq('id', idResult.data)
    .maybeSingle();
  if (projectError) {
    logger.error('Lecture de la réalisation impossible', { userId, projectId: idResult.data, error: projectError.message });
    return res.status(500).json({ error: 'La réalisation n’a pas pu être chargée.' });
  }
  if (!project) return res.status(404).json({ error: 'Réalisation introuvable.' });
  if (project.artisan_id !== userId) return res.status(403).json({ error: 'Cette réalisation ne vous appartient pas.' });

  const { data: mediaRows, error: mediaError } = await supabase
    .from('artisan_project_media')
    .select('storage_path, caption, position')
    .eq('project_id', project.id)
    .order('position', { ascending: true })
    .limit(30);
  if (mediaError) {
    logger.error('Lecture des photos de la réalisation impossible', { projectId: project.id, error: mediaError.message });
    return res.status(500).json({ error: 'Les photos de la réalisation n’ont pas pu être chargées.' });
  }
  if (!mediaRows?.length) return res.status(400).json({ error: 'Ajoutez au moins une photo avant de générer le PowerPoint.' });

  try {
    const media: PresentationMedia[] = [];
    let totalImageBytes = 0;
    for (const row of mediaRows) {
      if (!row.storage_path.startsWith(`${userId}/${project.id}/`)) {
        throw new Error('Une photo de la réalisation possède un chemin invalide.');
      }
      const extension: 'png' | 'jpg' = row.storage_path.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
      if (!/\.(png|jpe?g)$/i.test(row.storage_path)) {
        throw new Error('Les photos doivent être au format PNG ou JPEG pour générer le PowerPoint.');
      }
      const { data: image, error: imageError } = await supabase.storage.from(BUCKET).download(row.storage_path);
      if (imageError || !image) throw imageError ?? new Error('Une photo de la réalisation est introuvable.');
      if (image.size > MAX_GENERATED_IMAGE_BYTES) {
        throw new Error('Une photo dépasse 8 Mo. Réduisez sa taille puis réessayez.');
      }
      totalImageBytes += image.size;
      if (totalImageBytes > MAX_TOTAL_GENERATED_IMAGE_BYTES) {
        throw new Error('Les photos dépassent ensemble la limite de 45 Mo du PowerPoint.');
      }
      media.push({
        data: Buffer.from(await image.arrayBuffer()),
        extension,
        caption: row.caption,
      });
    }

    const presentation = await createPresentation(project, media);
    const presentationPath = `${userId}/${project.id}/presentation.pptx`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(presentationPath, presentation, {
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: updated, error: updateError } = await supabase
      .from('artisan_projects')
      .update({ pptx_path: presentationPath, updated_at: new Date().toISOString() })
      .eq('id', project.id)
      .eq('artisan_id', userId)
      .select('id, pptx_path')
      .single();
    if (updateError || !updated) {
      const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([presentationPath]);
      if (cleanupError) logger.error('Nettoyage du PowerPoint généré impossible', { projectId: project.id, error: cleanupError.message });
      throw updateError ?? new Error('Le chemin du PowerPoint n’a pas pu être enregistré.');
    }

    return res.json({
      projectId: updated.id,
      pptxPath: updated.pptx_path,
      pptxUrl: supabase.storage.from(BUCKET).getPublicUrl(updated.pptx_path).data.publicUrl,
    });
  } catch (error) {
    logger.error('Génération du PowerPoint impossible', { userId, projectId: project.id, error: errorMessage(error) });
    return res.status(500).json({ error: errorMessage(error) });
  }
};
