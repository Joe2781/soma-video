export type ProductionStatus = 'draft' | 'story_planned' | 'screenplay_planned' | 'shot_planned' | 'rendering' | 'complete';

export type Production = {
  id: string;
  title: string;
  idea: string;
  status: ProductionStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type StoryPlanRecord = {
  id: string;
  productionId: string;
  title: string;
  logline: string;
  genre: string;
  tone: string;
  premise: string;
  acts: Array<{
    actNumber: number;
    title: string;
    summary: string;
    beats: string[];
  }>;
  createdAt: Date;
  updatedAt: Date;
};

export type ScenePlanRecord = {
  id: string;
  productionId: string;
  storyPlanId: string;
  sceneNumber: number;
  title: string;
  setting: string;
  objective: string;
  conflict: string;
  cinematicNotes: string;
  transition: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ShotPlanRecord = {
  id: string;
  productionId: string;
  storyPlanId: string;
  scenePlanId: string;
  sceneNumber: number;
  shotNumber: number;
  description: string;
  camera: string;
  lens: string;
  movement: string;
  composition: string;
  durationSeconds: number;
  visualNotes: string;
  createdAt: Date;
  updatedAt: Date;
};
