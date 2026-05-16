export interface IsolateInfo {
  rootLib?: { uri: string };
  libraries?: Array<{ uri: string }>;
  extensionRPCs?: string[];
  pauseEvent?: { kind: string };
}
