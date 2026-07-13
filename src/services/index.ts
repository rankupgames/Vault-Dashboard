export { AIDispatcher, isAIEnabled, parseJsonArray, gatherContext, composePrompt } from './AIDispatcher';
export type { IAIDispatcher, AIAction, AIContext } from './AIDispatcher';
export { ReportScanner } from './ReportScanner';
export type { ReportEntry } from './ReportScanner';
export { DocumentTracker } from './DocumentTracker';
export type { DocumentEntry } from './DocumentTracker';
export { AnalyticsExporter } from './AnalyticsExporter';
export { TaskImporter } from './TaskImporter';
export type { TaskImportItem } from './TaskImporter';
export { BackupService } from './BackupService';
export { TaskParser } from './TaskParser';
export type { ParsedChecklistItem } from './TaskParser';
export { TodoSyncService } from './TodoSyncService';
export type { TodoImportRequest, TodoSyncDependencies, TodoSyncSummary } from './TodoSyncService';
export {
	AITaskManifestIngestor,
	AI_TASK_MANIFEST_SCHEMA_VERSION,
	composeAITaskExecutionPrompt,
	getAITaskInboxPath,
	isAITaskManifestPath,
	parseAITaskManifest,
} from './AITaskCurator';
export type {
	AITaskManifest,
	AITaskManifestActor,
	AITaskManifestInboxResult,
	AITaskManifestIngestionFailure,
	AITaskManifestIngestionResult,
	AITaskManifestIngestorDependencies,
	AITaskManifestSource,
	AITaskManifestSubtask,
	AITaskManifestTask,
} from './AITaskCurator';
export { ensureVaultFolder } from './VaultUtils';
export { PopoutPositionTracker } from './PopoutPositionTracker';
export type { ScreenPosition, DisplayBounds, PopoutWindowHandle, PopoutPositionTrackerOpts } from './PopoutPositionTracker';
