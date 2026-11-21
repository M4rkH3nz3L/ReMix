/**
 * Command-réteg (full-plan F0): minden szerkesztő-művelet nevesített command,
 * amit egy pure reducer alkalmaz. A user és később az AI ugyanezen a felületen
 * dolgozik — az AI kimenete validálva, undo-zhatóan fut le (anti-cél: AI sosem
 * írja közvetlenül a state-et).
 */
// Barrel: a megvalósítás a `src/lib/commandBus/` modulcsaládban él — típusok (`types.ts`),
// diszpécser (`applyCommand.ts`), felelősség szerinti reducerek (`*Reducers.ts`) és az
// event-log összefoglaló (`describeCommand.ts`).

export type { EditorCommand, EventActor, ProjectEvent } from '@/lib/commandBus/types';
export { applyCommand } from '@/lib/commandBus/applyCommand';
export { describeCommand } from '@/lib/commandBus/describeCommand';
