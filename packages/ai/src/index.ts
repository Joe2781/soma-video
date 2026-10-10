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

const ScreenplaySceneSchema = z.object({
  sceneNumber: z.number().int().positive(),
  heading: z.string().min(2),
  location: z.string().min(2),
  timeOfDay: z.string().min(2),
  visualBeat: z.string().min(10),
  action: z.string().min(20),
  dialogue: z.string().min(20),
  continuityNotes: z.array(z.string().min(5)).min(1),
});

const ScreenplayPlanSchema = z.object({
  title: z.string().min(2),
  logline: z.string().min(10),
  scenes: z.array(ScreenplaySceneSchema).min(1),
});

const ContinuityWarningSchema = z.object({
  issue: z.string().min(5),
  severity: z.enum(['low', 'medium', 'high']),
  sceneNumber: z.number().int().positive(),
  recommendation: z.string().min(5),
});

const ShotPlanItemSchema = z.object({
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

const ShotPlanSchema = z.object({
  title: z.string().min(2),
  logline: z.string().min(10),
  shots: z.array(ShotPlanItemSchema).min(1),
});

export type DirectorShot = z.infer<typeof DirectorShotSchema>;
export type DirectorScene = z.infer<typeof DirectorSceneSchema>;
export type DirectorAct = z.infer<typeof DirectorActSchema>;
export type DirectorPlan = z.infer<typeof DirectorPlanSchema>;

export type ScreenplayScene = z.infer<typeof ScreenplaySceneSchema>;
export type ScreenplayPlan = z.infer<typeof ScreenplayPlanSchema>;
export type ContinuityWarning = z.infer<typeof ContinuityWarningSchema>;
export type ShotPlanItem = z.infer<typeof ShotPlanItemSchema>;
export type ShotPlan = z.infer<typeof ShotPlanSchema>;

export type VeoVideoStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

export type VeoOperationState = {
  name: string;
  done: boolean;
  status: VeoVideoStatus;
  error?: { message?: string; code?: number; details?: any[] } | null;
  videoUrl?: string | null;
  metadata?: Record<string, any>;
};

export type VeoVideoGenerationResult = {
  operationName: string;
  status: VeoVideoStatus;
  model: string;
  prompt: string;
  videoUrl?: string | null;
  metadata?: Record<string, any>;
};

function normalizeGeminiResponse(raw: string): DirectorPlan {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned) as unknown;
  const validated = DirectorPlanSchema.parse(parsed);

  const shotsByScene = new Map<number, number>();
  for (const shot of validated.shots) {
    const count = shotsByScene.get(shot.sceneNumber) ?? 0;
    shotsByScene.set(shot.sceneNumber, count + 1);
  }

  if (shotsByScene.size === 0 || Math.min(...shotsByScene.values()) < 2) {
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
    throw new Error('GEMINI_API_KEY is not configured. Set the real Google Gemini API key in .env before using the AI Director.');
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
      contents: [{ parts: [{ text: userPrompt }] }],
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

export async function generateScreenplayPlan(
  idea: string,
  title: string,
  directorPlan?: DirectorPlan,
  options?: {
    model?: string;
    apiKey?: string;
  }
): Promise<ScreenplayPlan> {
  const apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY;
  const model = options?.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Set the real Google Gemini API key before using the screenplay planner.');
  }

  const systemPrompt = `You are the screenplay writer for Soma Video. Produce a structured screenplay based on the story plan.

Requirements:
- Output only valid JSON.
- Include title, logline, and scenes.
- Each scene must have sceneNumber, heading, location, timeOfDay, visualBeat, action, dialogue, and continuityNotes.
- The scenes must match the structure of the provided plan.
- Use professional screenplay prose but keep JSON text easy to store.
`;

  const userPrompt = `
User idea: ${idea}
Working title: ${title}
Director plan: ${JSON.stringify(directorPlan ?? { title, logline: 'Not provided yet' })}
Write a screenplay plan that preserves the core story, pacing, tension, and continuity.
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
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.75,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Gemini screenplay request failed (${response.status}): ${raw}`);
  }

  const payload = (await response.json()) as any;
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text ?? '')
    .join('')
    ?.trim();

  if (!text) {
    throw new Error('Gemini returned no screenplay content.');
  }

  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned) as unknown;
  return ScreenplayPlanSchema.parse(parsed);
}

export function validateContinuity(
  screenplay: ScreenplayPlan,
  directorPlan?: DirectorPlan
): ContinuityWarning[] {
  const warnings: ContinuityWarning[] = [];

  if (!screenplay || !screenplay.scenes?.length) {
    warnings.push({
      issue: 'No screenplay scenes were provided for continuity validation.',
      severity: 'high',
      sceneNumber: 1,
      recommendation: 'Generate a screenplay before validation.',
    });
    return warnings;
  }

  const sceneNumbers = screenplay.scenes.map((scene) => scene.sceneNumber);
  const duplicates = sceneNumbers.filter((num, idx) => sceneNumbers.indexOf(num) !== idx);
  if (duplicates.length > 0) {
    warnings.push({
      issue: 'Duplicate scene numbers detected in the screenplay.',
      severity: 'high',
      sceneNumber: duplicates[0],
      recommendation: 'Renumber scenes so each screenplay scene is unique.',
    });
  }

  for (const scene of screenplay.scenes) {
    if (!scene.action || scene.action.length < 20) {
      warnings.push({
        issue: `Scene ${scene.sceneNumber} lacks enough action detail.`,
        severity: 'medium',
        sceneNumber: scene.sceneNumber,
        recommendation: 'Expand the visual action in this scene to preserve continuity and clarity.',
      });
    }

    if (!scene.continuityNotes || scene.continuityNotes.length === 0) {
      warnings.push({
        issue: `Scene ${scene.sceneNumber} has no continuity notes.`,
        severity: 'medium',
        sceneNumber: scene.sceneNumber,
        recommendation: 'Add continuity notes for props, wardrobe, geography, and emotional state.',
      });
    }
  }

  if (directorPlan) {
    const directorSceneNumbers = directorPlan.scenes.map((scene) => scene.sceneNumber);
    const screenplaySceneNumbers = screenplay.scenes.map((scene) => scene.sceneNumber);
    const missingFromScreenplay = directorSceneNumbers.filter((num) => !screenplaySceneNumbers.includes(num));

    if (missingFromScreenplay.length > 0) {
      warnings.push({
        issue: 'Some director scenes do not appear in the screenplay.',
        severity: 'high',
        sceneNumber: missingFromScreenplay[0],
        recommendation: 'Ensure every planned director scene is represented in the screenplay.',
      });
    }
  }

  return warnings;
}

export async function generateShotPlan(
  idea: string,
  title: string,
  directorPlan?: DirectorPlan,
  screenplayPlan?: ScreenplayPlan,
  options?: {
    model?: string;
    apiKey?: string;
  }
): Promise<ShotPlan> {
  const apiKey = options?.apiKey ?? process.env.GEMINI_API_KEY;
  const model = options?.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Set the real Google Gemini API key before using the shot planner.');
  }

  const systemPrompt = `You are the Director of Photography for Soma Video. Turn the screenplay and story plan into a production-ready shot list.

Requirements:
- Output valid JSON only.
- Include title, logline, and shots.
- Each shot must include sceneNumber, shotNumber, description, camera, lens, movement, composition, durationSeconds, and visualNotes.
- Each scene should have 2 to 4 shots.
- The shots must support the scene objective and continuity.
- Keep shot descriptions cinematic and practical.
`;

  const userPrompt = `
User idea: ${idea}
Working title: ${title}
Director plan: ${JSON.stringify(directorPlan ?? { title, logline: 'Not provided yet' })}
Screenplay plan: ${JSON.stringify(screenplayPlan ?? { title, logline: 'Not provided yet', scenes: [] })}
Create a practical shot list that is consistent with the scene progression, pacing, and continuity.
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
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Gemini shot planner request failed (${response.status}): ${raw}`);
  }

  const payload = (await response.json()) as any;
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text ?? '')
    .join('')
    ?.trim();

  if (!text) {
    throw new Error('Gemini returned no shot plan content.');
  }

  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned) as unknown;
  return ShotPlanSchema.parse(parsed);
}

function getVeoApiKey(options?: { apiKey?: string }) {
  return options?.apiKey ?? process.env.VEO_API_KEY ?? process.env.GEMINI_API_KEY;
}

function extractVeoVideoUri(payload: any): string | null {
  const candidates = [
    payload?.response?.generatedVideos,
    payload?.response?.generated_videos,
    payload?.response?.videos,
    payload?.response?.generatedVideo,
    payload?.response?.generated_video,
    payload?.generatedVideos,
    payload?.generated_videos,
    payload?.videos,
  ];

  for (const candidate of candidates) {
    const items = Array.isArray(candidate) ? candidate : candidate ? [candidate] : [];
    for (const item of items) {
      const values = [
        item?.uri,
        item?.videoUri,
        item?.video_uri,
        item?.gcsUri,
        item?.gcs_uri,
        item?.url,
        item?.mediaUri,
        item?.media_uri,
        item?.video?.uri,
        item?.video?.url,
        item?.video?.gcsUri,
      ];
      const found = values.find((value) => typeof value === 'string' && value.trim().length > 0);
      if (found) return found;
    }
  }

  return null;
}

function resolveVeoStatus(payload: any): VeoVideoStatus {
  const state = String(payload?.state ?? payload?.status ?? '').toUpperCase();
  const done = Boolean(payload?.done);

  if (payload?.error || payload?.status === 'FAILED' || state === 'FAILED') {
    return 'failed';
  }

  if (payload?.status === 'CANCELLED' || state === 'CANCELLED') {
    return 'cancelled';
  }

  if (done || state === 'SUCCEEDED' || state === 'COMPLETED') {
    if (extractVeoVideoUri(payload)) {
      return 'succeeded';
    }
    return 'failed';
  }

  if (state === 'PENDING' || state === 'QUEUED' || payload?.status === 'QUEUED') {
    return 'queued';
  }

  if (state === 'RUNNING' || state === 'PROCESSING' || payload?.status === 'PROCESSING') {
    return 'processing';
  }

  return done ? 'succeeded' : 'processing';
}

export async function startVeoGeneration(
  prompt: string,
  options?: {
    model?: string;
    apiKey?: string;
    aspectRatio?: string;
    negativePrompt?: string;
    durationSeconds?: number;
    personGeneration?: string;
  }
): Promise<VeoVideoGenerationResult> {
  const apiKey = getVeoApiKey(options);
  if (!apiKey) {
    throw new Error('VEO_API_KEY is not configured. Set the real Google Veo API key before generating videos.');
  }

  if (!prompt || !prompt.trim()) {
    throw new Error('A non-empty prompt is required before generating a Veo video.');
  }

  const model = options?.model ?? process.env.VEO_MODEL ?? 'veo-3.1-generate-preview';
  const body: Record<string, any> = {
    prompt: prompt.trim(),
    ...(options?.negativePrompt ? { negativePrompt: options.negativePrompt.trim() } : {}),
    ...(options?.aspectRatio ? { aspectRatio: options.aspectRatio } : { aspectRatio: '16:9' }),
    ...(typeof options?.durationSeconds === 'number' ? { durationSeconds: options.durationSeconds } : { durationSeconds: 8 }),
    ...(options?.personGeneration ? { personGeneration: options.personGeneration } : { personGeneration: 'allow_adult' }),
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateVideo?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Veo generation failed (${response.status}): ${raw}`);
  }

  const payload = (await response.json()) as any;
  const operationName = payload?.name ?? payload?.operation?.name ?? payload?.operationName;

  if (!operationName) {
    throw new Error('Veo API did not return an operation name for the video job.');
  }

  const status = resolveVeoStatus(payload);
  return {
    operationName,
    status,
    model,
    prompt,
    videoUrl: extractVeoVideoUri(payload),
    metadata: payload,
  };
}

export async function pollVeoOperation(
  operationName: string,
  options?: { apiKey?: string }
): Promise<VeoOperationState> {
  const apiKey = getVeoApiKey(options);
  if (!apiKey) {
    throw new Error('VEO_API_KEY is not configured. Set the real Google Veo API key to poll video operations.');
  }

  if (!operationName || !operationName.trim()) {
    throw new Error('operationName is required when polling a Veo job.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/${encodeURIComponent(operationName)}?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Veo operation polling failed (${response.status}): ${raw}`);
  }

  const payload = (await response.json()) as any;
  const status = resolveVeoStatus(payload);
  const error = payload?.error ? { message: payload.error?.message, code: payload.error?.code, details: payload.error?.details } : null;

  return {
    name: operationName,
    done: Boolean(payload?.done),
    status,
    error,
    videoUrl: extractVeoVideoUri(payload),
    metadata: payload,
  };
}

export function buildProductionVideoPrompt(
  production: {
    title: string;
    idea: string;
    storyPlan?: { title?: string; logline?: string; premise?: string; genre?: string; tone?: string; acts?: Array<{ title?: string; summary?: string }> } | null;
    screenplayPlan?: { title?: string; logline?: string; scenes?: Array<{ heading?: string; visualBeat?: string; action?: string }> } | null;
  }
): string {
  const beats = production.storyPlan?.acts?.slice(0, 2).map((act) => act?.title ?? '').filter(Boolean) ?? [];
  const scenes = production.screenplayPlan?.scenes?.slice(0, 3).map((scene) => scene?.visualBeat ?? scene?.heading ?? '').filter(Boolean) ?? [];

  const base = `Create a cinematic 8-second video clip based on this film concept.`;
  const title = `Title: ${production.title || production.storyPlan?.title || 'Untitled production'}.`;
  const idea = `Concept: ${production.idea}.`;
  const logline = production.storyPlan?.logline ? `Logline: ${production.storyPlan.logline}.` : '';
  const premise = production.storyPlan?.premise ? `Premise: ${production.storyPlan.premise}.` : '';
  const visualBeats = scenes.length > 0 ? `Visual beats: ${scenes.join(' • ')}.` : '';
  const actSummary = beats.length > 0 ? `Story arc: ${beats.join(' -> ')}.` : '';

  return [base, title, idea, logline, premise, actSummary, visualBeats]
    .filter(Boolean)
    .join(' ')
    .trim();
}

export async function generateProductionVideo(
  production: {
    title: string;
    idea: string;
    storyPlan?: { title?: string; logline?: string; premise?: string; genre?: string; tone?: string; acts?: Array<{ title?: string; summary?: string }> } | null;
    screenplayPlan?: { title?: string; logline?: string; scenes?: Array<{ heading?: string; visualBeat?: string; action?: string }> } | null;
  },
  options?: {
    model?: string;
    apiKey?: string;
    aspectRatio?: string;
    durationSeconds?: number;
    negativePrompt?: string;
  }
): Promise<VeoVideoGenerationResult> {
  return startVeoGeneration(buildProductionVideoPrompt(production), options);
}

export async function waitForVeoCompletion(
  operationName: string,
  options?: {
    apiKey?: string;
    intervalMs?: number;
    timeoutMs?: number;
  }
): Promise<VeoOperationState> {
  const intervalMs = options?.intervalMs ?? 5000;
  const timeoutMs = options?.timeoutMs ?? 600000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await pollVeoOperation(operationName, { apiKey: options?.apiKey });
    if (state.done) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for Veo operation ${operationName} to complete.`);
}

export async function pollVeoUntilComplete(
  operationName: string,
  options?: {
    apiKey?: string;
    intervalMs?: number;
    timeoutMs?: number;
  }
): Promise<VeoOperationState> {
  return waitForVeoCompletion(operationName, options);
}

export function isVeoSucceeded(status: VeoVideoStatus | undefined): boolean {
  return status === 'succeeded';
}

export function isVeoFailed(status: VeoVideoStatus | undefined): boolean {
  return status === 'failed' || status === 'cancelled';
}

export async function fetchVeoVideoUrl(
  operationName: string,
  options?: { apiKey?: string }
): Promise<string | null> {
  const state = await pollVeoOperation(operationName, { apiKey: options?.apiKey });
  return state.videoUrl ?? null;
}

export { normalizeGeminiResponse };
