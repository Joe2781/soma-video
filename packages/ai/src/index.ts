import { z } from 'zod';

const DirectorShotSchema = z.object({
  sceneNumber: z.number().int().positive(),
  shotNumber: z.number().int().positive(),
  description: z.string().min(10),
  camera: z.string().min(2),
  lens: z.string().min(2),
  movement: z.string().min(2),
  composition: z.string().min(2),
  durationSeconds: z.number().int().min(2).max(15),
  visualNotes: z.string().min(5),
});

const DirectorSceneSchema = z.object({
  sceneNumber: z.number().int().positive(),
  title: z.string().min(2),
  setting: z.string().min(2),
  objective: z.string().min(5),
  conflict: z.string().min(5),
  cinematicNotes: z.string().min(10),
  transition: z.string().min(5),
});

const DirectorActSchema = z.object({
  actNumber: z.number().int().min(1).max(3),
  title: z.string().min(2),
  summary: z.string().min(10),
  beats: z.array(z.string().min(5)).min(2).max(6),
});

const DirectorPlanSchema = z.object({
  title: z.string().min(2),
  logline: z.string().min(10),
  genre: z.string().min(2),
  tone: z.string().min(2),
  premise: z.string().min(20),
  acts: z.array(DirectorActSchema).length(3),
  scenes: z.array(DirectorSceneSchema).min(5).max(8),
  shots: z.array(DirectorShotSchema).min(10),
});

export type DirectorShot = z.infer<typeof DirectorShotSchema>;
export type DirectorScene = z.infer<typeof DirectorSceneSchema>;
export type DirectorAct = z.infer<typeof DirectorActSchema>;
export type DirectorPlan = z.infer<typeof DirectorPlanSchema>;

function normalizeGeminiResponse(raw: string): DirectorPlan {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned) as unknown;
  const validated = DirectorPlanSchema.parse(parsed);

  // Keep the plan logically consistent even when a model returns out-of-range data.
  const shotsByScene = new Map<number, number>();
  for (const shot of validated.shots) {
    const sceneCount = shotsByScene.get(shot.sceneNumber) ?? 0;
    shotsByScene.set(shot.sceneNumber, sceneCount + 1);
  }

  if (Math.min(...shotsByScene.values()) < 2) {
    throw new Error('Generated plan must contain at least 2 shots per scene.');
  }

  return validated;
}

export async function generateDirectorPlan(
  idea: string,
  title: string,
  options?: {
    model?: string;
    apiKey?: string;
  }
): Promise<DirectorPlan> {
  const apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY;
  const model = options?.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Set the real Google Gemini API key in .env before using the AI Director.'
    );
  }

  if (!idea || !idea.trim()) {
    throw new Error('idea is required before generating a director plan.');
  }

  const systemPrompt = `You are the AI Director for Soma Video. Transform the user film idea into a production-ready plan.

You must output valid JSON only, no markdown fences and no commentary.
Requirements:
- 3 acts
- 5 to 8 scenes
- 2 to 4 shots per scene
- cinematic, concrete, production-usable output
- include title, logline, genre, tone, premise, acts, scenes, and shots
- durationSeconds must be an integer between 2 and 15
- all scene numbers and shot numbers must be sequential and consistent
- the plan must be based on the user's actual idea and title
`;

  const userPrompt = `
User idea: ${idea}
Working title: ${title}
Create a cinematic director's plan for a complete short film or feature-length concept.
Return a single JSON object only.
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${raw}`);
  }

  const payload = (await response.json()) as any;
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text ?? '')
    .join('')
    ?.trim();

  if (!text) {
    throw new Error('Gemini returned no content for the director plan.');
  }

  try {
    return normalizeGeminiResponse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown validation error';
    throw new Error(`Gemini returned an invalid plan: ${message}`);
  }
}
