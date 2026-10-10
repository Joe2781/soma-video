import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { prisma } from '@soma/db';
import {
  generateDirectorPlan,
  generateScreenplayPlan,
  validateContinuity,
  generateProductionVideo,
  pollVeoOperation,
  buildProductionVideoPrompt,
} from '@soma/ai';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    app: 'soma-video-api',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/ready', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ready: true, database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({
      ready: false,
      database: 'unavailable',
      message: (error as Error).message,
    });
  }
});

app.post('/api/productions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const title = String(req.body?.title ?? '').trim();
    const idea = String(req.body?.idea ?? '').trim();

    if (!title || !idea) {
      return res.status(400).json({ error: 'title and idea are required' });
    }

    const production = await prisma.production.create({
      data: {
        title,
        idea,
        status: 'draft',
      },
    });

    return res.status(201).json(production);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/productions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const offset = Number(req.query.offset ?? 0);

    const [productions, total] = await Promise.all([
      prisma.production.findMany({
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.production.count(),
    ]);

    return res.json({
      data: productions,
      pagination: { limit, offset, total },
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/productions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.id },
      include: {
        storyPlan: { include: { scenePlans: true, shotPlans: true } },
        screenplayPlan: { include: { scenes: true } },
        videoAssets: true,
      },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found' });
    }

    return res.json(production);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/productions/:id/plan', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.id },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found' });
    }

    const existing = await prisma.storyPlan.findFirst({
      where: { productionId: production.id },
    });

    if (existing) {
      return res.status(409).json({
        error: 'A director plan already exists for this production.',
        storyPlanId: existing.id,
      });
    }

    const plan = await generateDirectorPlan(production.idea, production.title, {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL,
    });

    const storyPlan = await prisma.storyPlan.create({
      data: {
        productionId: production.id,
        title: plan.title,
        logline: plan.logline,
        genre: plan.genre,
        tone: plan.tone,
        premise: plan.premise,
        acts: plan.acts,
      },
    });

    const sceneRecords = await Promise.all(
      plan.scenes.map((scene) =>
        prisma.scenePlan.create({
          data: {
            productionId: production.id,
            storyPlanId: storyPlan.id,
            sceneNumber: scene.sceneNumber,
            title: scene.title,
            setting: scene.setting,
            objective: scene.objective,
            conflict: scene.conflict,
            cinematicNotes: scene.cinematicNotes,
            transition: scene.transition,
          },
        })
      )
    );

    await Promise.all(
      plan.shots
        .map((shot) => {
          const scenePlan = sceneRecords.find((record) => record.sceneNumber === shot.sceneNumber);
          if (!scenePlan) return null;

          return prisma.shotPlan.create({
            data: {
              productionId: production.id,
              storyPlanId: storyPlan.id,
              scenePlanId: scenePlan.id,
              sceneNumber: shot.sceneNumber,
              shotNumber: shot.shotNumber,
              description: shot.description,
              camera: shot.camera,
              lens: shot.lens,
              movement: shot.movement,
              composition: shot.composition,
              durationSeconds: shot.durationSeconds,
              visualNotes: shot.visualNotes,
            },
          });
        })
        .filter(Boolean)
    );

    await prisma.production.update({
      where: { id: production.id },
      data: { status: 'story_planned' },
    });

    return res.status(201).json({
      productionId: production.id,
      storyPlanId: storyPlan.id,
      plan,
      message: 'AI Director plan generated and persisted successfully.',
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/productions/:id/screenplay', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const screenplay = await prisma.screenplayPlan.findUnique({
      where: { productionId: req.params.id },
      include: { scenes: true },
    });

    if (!screenplay) {
      return res.status(404).json({ error: 'Screenplay not found for this production.' });
    }

    return res.json(screenplay);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/productions/:id/screenplay', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.id },
      include: { storyPlan: { include: { scenePlans: true, shotPlans: true } } },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found' });
    }

    if (!production.storyPlan) {
      return res.status(400).json({ error: 'A director plan must exist before generating a screenplay.' });
    }

    const directorPlan = {
      title: production.storyPlan.title,
      logline: production.storyPlan.logline,
      genre: production.storyPlan.genre,
      tone: production.storyPlan.tone,
      premise: production.storyPlan.premise,
      acts: Array.isArray(production.storyPlan.acts) ? (production.storyPlan.acts as any[]) : [],
      scenes: production.storyPlan.scenePlans.map((scene) => ({
        sceneNumber: scene.sceneNumber,
        title: scene.title,
        setting: scene.setting,
        objective: scene.objective,
        conflict: scene.conflict,
        cinematicNotes: scene.cinematicNotes,
        transition: scene.transition,
      })),
      shots: production.storyPlan.shotPlans.map((shot) => ({
        sceneNumber: shot.sceneNumber,
        shotNumber: shot.shotNumber,
        description: shot.description,
        camera: shot.camera,
        lens: shot.lens,
        movement: shot.movement,
        composition: shot.composition,
        durationSeconds: shot.durationSeconds,
        visualNotes: shot.visualNotes,
      })),
    };

    const screenplay = await generateScreenplayPlan(production.idea, production.title, directorPlan, {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL,
    });

    const continuityWarnings = validateContinuity(screenplay, directorPlan);

    const savedScreenplay = await prisma.screenplayPlan.create({
      data: {
        productionId: production.id,
        storyPlanId: production.storyPlan.id,
        title: screenplay.title,
        logline: screenplay.logline,
        continuityWarnings: continuityWarnings,
      },
    });

    await Promise.all(
      screenplay.scenes.map((scene) =>
        prisma.screenplayScene.create({
          data: {
            productionId: production.id,
            screenplayPlanId: savedScreenplay.id,
            sceneNumber: scene.sceneNumber,
            heading: scene.heading,
            location: scene.location,
            timeOfDay: scene.timeOfDay,
            visualBeat: scene.visualBeat,
            action: scene.action,
            dialogue: scene.dialogue,
            continuityNotes: scene.continuityNotes,
          },
        })
      )
    );

    await prisma.production.update({
      where: { id: production.id },
      data: { status: 'screenplay_planned' },
    });

    return res.status(201).json({
      productionId: production.id,
      screenplayPlanId: savedScreenplay.id,
      screenplay,
      continuityWarnings,
      message: 'Screenplay generated, continuity validated, and persisted successfully.',
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/productions/:id/videos', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assets = await prisma.videoAsset.findMany({
      where: { productionId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ data: assets });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/productions/:id/render', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.id },
      include: {
        storyPlan: true,
        screenplayPlan: { include: { scenes: true } },
      },
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found' });
    }

    const prompt = req.body?.prompt || buildProductionVideoPrompt({
      title: production.title,
      idea: production.idea,
      storyPlan: production.storyPlan
        ? {
            title: production.storyPlan.title,
            logline: production.storyPlan.logline,
            premise: production.storyPlan.premise,
            genre: production.storyPlan.genre,
            tone: production.storyPlan.tone,
            acts: Array.isArray(production.storyPlan.acts) ? (production.storyPlan.acts as any[]) : [],
          }
        : null,
      screenplayPlan: production.screenplayPlan
        ? {
            title: production.screenplayPlan.title,
            logline: production.screenplayPlan.logline,
            scenes: production.screenplayPlan.scenes.map((scene) => ({
              heading: scene.heading,
              visualBeat: scene.visualBeat,
              action: scene.action,
            })),
          }
        : null,
    });

    const result = await generateProductionVideo(
      {
        title: production.title,
        idea: production.idea,
        storyPlan: production.storyPlan
          ? {
              title: production.storyPlan.title,
              logline: production.storyPlan.logline,
              premise: production.storyPlan.premise,
              genre: production.storyPlan.genre,
              tone: production.storyPlan.tone,
              acts: Array.isArray(production.storyPlan.acts) ? (production.storyPlan.acts as any[]) : [],
            }
          : null,
        screenplayPlan: production.screenplayPlan
          ? {
              title: production.screenplayPlan.title,
              logline: production.screenplayPlan.logline,
              scenes: production.screenplayPlan.scenes.map((scene) => ({
                heading: scene.heading,
                visualBeat: scene.visualBeat,
                action: scene.action,
              })),
            }
          : null,
      },
      {
        apiKey: process.env.VEO_API_KEY ?? process.env.GEMINI_API_KEY,
        model: process.env.VEO_MODEL,
        aspectRatio: String(req.body?.aspectRatio ?? '16:9'),
        durationSeconds: Number(req.body?.durationSeconds ?? 8),
        negativePrompt: req.body?.negativePrompt,
      }
    );

    const createdAsset = await prisma.videoAsset.create({
      data: {
        productionId: production.id,
        title: production.title,
        prompt,
        model: result.model,
        operationName: result.operationName,
        status: result.status,
        videoUrl: result.videoUrl ?? null,
        metadata: result.metadata ?? {},
      },
    });

    await prisma.production.update({
      where: { id: production.id },
      data: { status: 'rendering' },
    });

    return res.status(202).json({
      productionId: production.id,
      assetId: createdAsset.id,
      operationName: result.operationName,
      status: result.status,
      videoUrl: result.videoUrl ?? null,
      message: 'Veo video generation started asynchronously.',
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/productions/:id/render/:videoId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asset = await prisma.videoAsset.findFirst({
      where: { id: req.params.videoId, productionId: req.params.id },
    });

    if (!asset) {
      return res.status(404).json({ error: 'Video asset not found.' });
    }

    if (!asset.operationName) {
      return res.json({
        id: asset.id,
        status: asset.status,
        videoUrl: asset.videoUrl,
        complete: asset.status === 'succeeded',
      });
    }

    const poll = await pollVeoOperation(asset.operationName, {
      apiKey: process.env.VEO_API_KEY ?? process.env.GEMINI_API_KEY,
    });

    const nextStatus = poll.status === 'succeeded' ? 'succeeded' : poll.status === 'failed' ? 'failed' : poll.status === 'cancelled' ? 'cancelled' : asset.status === 'succeeded' ? 'succeeded' : 'processing';

    const updatedAsset = await prisma.videoAsset.update({
      where: { id: asset.id },
      data: {
        status: nextStatus,
        videoUrl: poll.videoUrl ?? asset.videoUrl ?? null,
        metadata: poll.metadata ?? asset.metadata ?? {},
      },
    });

    if (poll.status === 'succeeded') {
      await prisma.production.update({
        where: { id: req.params.id },
        data: { status: 'complete' },
      });
    }

    return res.json({
      id: updatedAsset.id,
      operationName: asset.operationName,
      status: updatedAsset.status,
      videoUrl: updatedAsset.videoUrl,
      done: poll.done,
      error: poll.error,
      metadata: updatedAsset.metadata,
    });
  } catch (error) {
    return next(error);
  }
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
  });
});

export { app };

if (require.main === module) {
  const port = Number(process.env.PORT || 3001);
  app.listen(port, () => {
    console.log(`Soma Video API listening on http://localhost:${port}`);
  });
}
