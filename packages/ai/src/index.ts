export type DirectorShot = {
  sceneNumber: number;
  shotNumber: number;
  description: string;
  camera: string;
  lens: string;
  movement: string;
  composition: string;
  durationSeconds: number;
  visualNotes: string;
};

export type DirectorScene = {
  sceneNumber: number;
  title: string;
  setting: string;
  objective: string;
  conflict: string;
  cinematicNotes: string;
  transition: string;
};

export type DirectorAct = {
  actNumber: number;
  title: string;
  summary: string;
  beats: string[];
};

export type DirectorPlan = {
  title: string;
  logline: string;
  genre: string;
  tone: string;
  premise: string;
  acts: DirectorAct[];
  scenes: DirectorScene[];
  shots: DirectorShot[];
};

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
    throw new Error('GEMINI_API_KEY is not configured. Set the real Google Gemini API key before using the AI Director.');
  }

  const prompt = `
You are the AI Director for Soma Video. Generate a real film-production plan for the user idea.

Requirements:
- Return valid JSON only.
- The JSON object must match this schema:
{
  "title": "string",
  "logline": "string",
  "genre": "string",
  "tone": "string",
  "premise": "string",
  "acts": [{ "actNumber": 1, "title": "string", "summary": "string", "beats": ["string"] }],
  "scenes": [{ "sceneNumber": 1, "title": "string", "setting": "string", "objective": "string", "conflict": "string", "cinematicNotes": "string", "transition": "string" }],
  "shots": [{ "sceneNumber": 1, "shotNumber": 1, "description": "string", "camera": "string", "lens": "string", "movement": "string", "composition": "string", "durationSeconds": 5, "visualNotes": "string" }]
}
- Treat this as a production-ready plan, not a demo.
- Make the output cinematic, structured, and practical for shooting.
- Use the following user idea as the creative source:
${idea}
- Suggested working title: ${title}
- Return a complete plan with 3 acts, 5-8 scenes, and 2-4 shots per scene.
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: 'You are the AI Director for Soma Video. Write structured, cinematic, and production-usable JSON output only.'
          }
        ]
      },
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${raw}`);
  }

  const payload = await response.json() as any;
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text ?? '')
    .join('')
    ?.trim();

  if (!text) {
    throw new Error('Gemini returned no content for the director plan.');
  }

  const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(cleaned) as DirectorPlan;

  if (!parsed || !parsed.title || !parsed.scenes || !parsed.shots) {
    throw new Error('Gemini response did not contain a valid director plan object.');
  }

  return parsed;
}
