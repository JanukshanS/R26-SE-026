export type HeightStep = 'overhead' | 'chest' | 'waist';

export const HEIGHT_STEPS: HeightStep[] = ['overhead', 'chest', 'waist'];

export type StopPhoto = {
  stopIndex: number;
  heightStep: HeightStep;
  uri: string;
  capturedAtIso: string;
};
