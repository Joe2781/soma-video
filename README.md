# Soma Video

Soma Video is a real AI film-production system. The product principle is: "Veo is the video generator. Soma Video is the filmmaker."

The core of the system is an AI Director that turns a user idea into a structured production plan: story premise, acts, scenes, and shot lists. The generated output is persisted to a database so it can later be rendered by video, audio, VFX, and editing pipelines.

## Stack

- Node.js 20+
- TypeScript
- Express.js
- PostgreSQL
- Prisma ORM
- Google Gemini API

## Structure

```bash
apps/
  api/
packages/
  ai/
  core/
  db/
```

## Local development

```bash
npm install
cp .env.example .env
npm run db:generate
npm run dev
```

## API endpoints

- `GET /api/health`
- `POST /api/productions`
- `GET /api/productions/:id`
- `POST /api/productions/:id/plan`

## Notes

- This repository intentionally uses real APIs and real state.
- If Gemini credentials are absent, the API will fail loudly rather than simulating a result.
