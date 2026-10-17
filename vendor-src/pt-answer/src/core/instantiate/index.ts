/**
 * impulse copy: upstream's instantiate module builds problem instances; this
 * copy only needs the shapes grade/index.ts reads, for its type-only imports.
 */
export interface Slot {
  index: number;
  kind: 'value' | 'unit' | 'combined';
}

export interface InstancePart {
  partId: string;
  slots: Slot[];
  modelAnswer: number;
}

export interface ProblemInstance {
  parts: InstancePart[];
}
