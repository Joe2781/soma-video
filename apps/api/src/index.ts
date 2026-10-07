import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { prisma } from '@soma/db';
import { generateDirectorPlan } from '@soma/ai';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    app: 'soma-video-api',
    timestamp: new Date().toISOString()
  });
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
        status: 'draft'
      }
    });

    return res.status(201).json(production);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/productions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const production = await prisma.production.findUnique({
      where: { id: req.params.id },
      include: {
        storyPlan: {
          include: {
            scenePlans: true,
            shotPlans: true
          }
        }
      }
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
      where: { id: req.params.id }
    });

    if (!production) {
      return res.status(404).json({ error: 'Production not found' });
    }

    const plan = await generateDirectorPlan(production.idea, production.title, {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL
    });

    const storyPlan = await prisma.storyPlan.create({
      data: {
        productionId: production.id,
        title: plan.title,
        logline: plan.logline,
        genre: plan.genre,
        tone: plan.tone,
        premise: plan.premise,
        acts: plan.acts
      }
    });

    const sceneRecords = await Promise.all(
      plan.scenes.map(async (scene) => {
        return prisma.scenePlan.create({
          data: {
            productionId: production.id,
            storyPlanId: storyPlan.id,
            sceneNumber: scene.sceneNumber,
            title: scene.title,
            setting: scene.setting,
            objective: scene.objective,
            conflict: scene.conflict,
            cinematicNotes: scene.cinematicNotes,
            transition: scene.transition
          }
        });
      })
    );

    await Promise.all(
      plan.shots.map(async (shot) => {
        const scenePlan = sceneRecords.find((record) => record.sceneNumber === shot.sceneNumber);

        if (!scenePlan) {
          return null;
        }

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
            visualNotes: shot.visualNotes
          }
        });
      })
    );

    await prisma.production.update({
      where: { id: production.id },
      data: { status: 'story_planned' }
    });

    return res.status(201).json({
      productionId: production.id,
      storyPlanId: storyPlan.id,
      plan,
      message: 'AI Director plan generated and persisted.'
    });
  } catch (error) {
    return next(error);
  }
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

export { app };

if (require.main === module) {
  const port = Number(process.env.PORT || 3001);
  app.listen(port, () => {
    console.log(`Soma Video API listening on http://localhost:${port}`);
  });
}
